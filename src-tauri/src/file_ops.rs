use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};

use tempfile::NamedTempFile;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DirectoryEntry {
    pub(crate) name: String,
    pub(crate) path: PathBuf,
    pub(crate) is_directory: bool,
}

fn invalid_path_error(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

/// Reject symbolic links and parent traversal in the existing part of an
/// absolute path. This keeps a lexically allowed new child from escaping
/// through an intermediate symlink before the caller opens it.
fn reject_symlink_components(path: &Path) -> io::Result<()> {
    if !path.is_absolute() {
        return Err(invalid_path_error("filesystem paths must be absolute"));
    }

    let mut current = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => current.push(prefix.as_os_str()),
            Component::RootDir => current.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err(invalid_path_error("parent traversal is not allowed"));
            }
            Component::Normal(segment) => {
                current.push(segment);
                match fs::symlink_metadata(&current) {
                    Ok(metadata) if metadata.file_type().is_symlink() => {
                        return Err(invalid_path_error("symbolic links are not allowed"));
                    }
                    Ok(_) => {}
                    Err(error) if error.kind() == io::ErrorKind::NotFound => break,
                    Err(error) => return Err(error),
                }
            }
        }
    }

    Ok(())
}

/// Return an existing, canonical path only after rejecting every symlink in
/// its traversal. The canonical result is safe to compare against a scope.
pub(crate) fn canonical_existing_path(path: &Path) -> io::Result<PathBuf> {
    reject_symlink_components(path)?;
    fs::canonicalize(path)
}

/// Canonicalize the existing parent of a new leaf and rebuild that leaf below
/// it. This prevents an authorized lexical path such as `root/link/new.md`
/// from escaping when `link` points outside `root`.
pub(crate) fn canonical_new_child_path(path: &Path) -> io::Result<PathBuf> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| invalid_path_error("new paths require an existing parent"))?;
    let file_name = path
        .file_name()
        .filter(|file_name| !file_name.is_empty())
        .ok_or_else(|| invalid_path_error("new paths require a file or folder name"))?;

    Ok(canonical_existing_path(parent)?.join(file_name))
}

/// Write through a random sibling temp file, then atomically replace the target.
/// A failed replacement leaves the target untouched; there is no direct-write
/// fallback. The sibling location keeps the replacement on the target volume.
pub(crate) fn write_atomic(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = target
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."));
    let existing_permissions = fs::metadata(target).ok().map(|meta| meta.permissions());
    let mut temp = NamedTempFile::new_in(&dir)?;
    if let Some(permissions) = existing_permissions {
        temp.as_file().set_permissions(permissions)?;
    }
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(target).map_err(|error| error.error)?;

    #[cfg(unix)]
    fs::File::open(&dir)?.sync_all()?;

    Ok(())
}

/// List immediate directory children without following or exposing symlinks for
/// renderer recursion.
pub(crate) fn read_directory(path: &Path) -> io::Result<Vec<DirectoryEntry>> {
    let mut entries = Vec::new();
    for item in fs::read_dir(path)? {
        let item = item?;
        let file_type = item.file_type()?;
        if file_type.is_symlink() {
            continue;
        }
        entries.push(DirectoryEntry {
            name: item.file_name().to_string_lossy().to_string(),
            path: item.path(),
            is_directory: file_type.is_dir(),
        });
    }
    Ok(entries)
}

/// Atomically create one new file. Existing files and dangling symlinks fail.
pub(crate) fn create_file(path: &Path) -> io::Result<()> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map(|_| ())
}

/// Create exactly one directory; callers must already hold a directory grant.
pub(crate) fn create_folder(path: &Path) -> io::Result<()> {
    fs::create_dir(path)
}

/// Use the platform's atomic no-replace rename primitive. Unsupported filesystems
/// return an error instead of reintroducing a check-then-rename race.
pub(crate) fn rename_without_overwrite(from: &Path, to: &Path) -> io::Result<()> {
    renamore::rename_exclusive(from, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::error::Error;
    #[cfg(unix)]
    use std::os::unix::fs::symlink;
    use tempfile::tempdir;

    #[test]
    fn atomic_write_replaces_existing_contents() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("document.md");
        fs::write(&target, "old document")?;

        write_atomic(&target, b"new document")?;

        assert_eq!(fs::read_to_string(&target)?, "new document");
        Ok(())
    }

    #[test]
    fn create_file_refuses_an_existing_destination() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("existing.md");
        fs::write(&target, "keep")?;

        assert!(create_file(&target).is_err());
        assert_eq!(fs::read_to_string(&target)?, "keep");
        Ok(())
    }

    #[test]
    fn canonical_new_child_path_uses_the_existing_parent() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("new.md");

        assert_eq!(
            canonical_new_child_path(&target)?,
            fs::canonicalize(dir.path())?.join("new.md"),
        );
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_does_not_follow_a_predictable_temp_symlink() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("document.md");
        let predictable_temp = dir.path().join(".document.md.markd-tmp");
        let victim = dir.path().join("victim.md");
        fs::write(&victim, "keep this content")?;
        symlink(&victim, &predictable_temp)?;

        write_atomic(&target, b"new document")?;

        assert_eq!(fs::read_to_string(&victim)?, "keep this content");
        assert_eq!(fs::read_to_string(&target)?, "new document");
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn read_directory_does_not_expose_a_symlinked_directory_for_recursion(
    ) -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let outside = tempdir()?;
        let symlinked_dir = dir.path().join("linked-outside");
        symlink(outside.path(), &symlinked_dir)?;

        let entries = read_directory(dir.path())?;

        assert!(entries.iter().all(|entry| entry.name != "linked-outside"));
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn create_file_does_not_follow_a_dangling_symlink() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("new.md");
        let outside = dir.path().join("outside.md");
        symlink(&outside, &target)?;

        assert!(create_file(&target).is_err());
        assert!(!outside.exists());
        Ok(())
    }

    #[test]
    fn create_folder_requires_an_existing_authorized_parent() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let target = dir.path().join("unapproved-parent").join("child");

        assert!(create_folder(&target).is_err());
        assert!(!target.parent().is_some_and(Path::exists));
        Ok(())
    }

    #[test]
    fn rename_does_not_replace_an_existing_destination() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let source = dir.path().join("source.md");
        let destination = dir.path().join("destination.md");
        fs::write(&source, "source")?;
        fs::write(&destination, "destination")?;

        assert!(rename_without_overwrite(&source, &destination).is_err());
        assert_eq!(fs::read_to_string(&source)?, "source");
        assert_eq!(fs::read_to_string(&destination)?, "destination");
        Ok(())
    }

    #[test]
    fn rename_moves_to_a_missing_destination() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let source = dir.path().join("source.md");
        let destination = dir.path().join("destination.md");
        fs::write(&source, "source")?;

        rename_without_overwrite(&source, &destination)?;

        assert!(!source.exists());
        assert_eq!(fs::read_to_string(&destination)?, "source");
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn canonical_new_child_path_rejects_an_intermediate_symlink() -> Result<(), Box<dyn Error>> {
        let dir = tempdir()?;
        let outside = tempdir()?;
        let linked_parent = dir.path().join("linked-outside");
        symlink(outside.path(), &linked_parent)?;

        let target = linked_parent.join("new.md");

        assert!(canonical_new_child_path(&target).is_err());
        assert!(!outside.path().join("new.md").exists());
        Ok(())
    }
}
