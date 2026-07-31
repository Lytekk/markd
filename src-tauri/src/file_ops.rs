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

/// Characters Windows forbids in a normalized path component. A verbatim path
/// may legally carry them; a plain path may not, so their presence means the
/// two spellings are not interchangeable.
const WINDOWS_RESERVED_CHARS: &[char] = &['<', '>', ':', '"', '|', '?', '*'];

/// Longest plain Windows path that is guaranteed to resolve without the
/// extended-length prefix.
const WINDOWS_MAX_PLAIN_PATH: usize = 260;

/// Rewrite `\\?\UNC\server\share\...` as `\\server\share\...`, or return None
/// when that rewrite would change meaning.
///
/// The verbatim prefix suppresses Windows path normalization, so stripping it is
/// only safe when the remainder would survive normalization untouched: no `.` or
/// `..` segments, no empty segments, no trailing dots or spaces, no characters
/// that are illegal in a plain path, and a length the plain form supports.
/// Written against `&str` rather than `Path` so it is exercised on every host,
/// not only on Windows where `Path` parses the prefix.
fn simplify_verbatim_unc(path: &str) -> Option<String> {
    const PREFIX: &str = r"\\?\UNC\";
    let remainder = path.strip_prefix(PREFIX)?;
    if remainder.is_empty() {
        return None;
    }

    for segment in remainder.split('\\') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return None;
        }
        if segment.ends_with('.') || segment.ends_with(' ') {
            return None;
        }
        if segment
            .chars()
            .any(|c| c.is_control() || c == '/' || WINDOWS_RESERVED_CHARS.contains(&c))
        {
            return None;
        }
    }

    let simplified = format!(r"\\{remainder}");
    if simplified.chars().count() > WINDOWS_MAX_PLAIN_PATH {
        return None;
    }
    Some(simplified)
}

/// Resolve a launch argument — a CLI argument or a single-instance forward — to
/// an absolute path, anchoring a relative argument to the launching process's
/// working directory. Parent traversal is refused outright rather than resolved,
/// so a launch argument can never reach outside the directory it was issued from.
pub(crate) fn resolve_launch_path(arg: &str, cwd: &Path) -> Option<PathBuf> {
    if arg.is_empty() {
        return None;
    }
    let path = Path::new(arg);
    if path.is_absolute() {
        return Some(path.to_path_buf());
    }
    if path
        .components()
        .any(|component| matches!(component, Component::ParentDir))
    {
        return None;
    }
    Some(cwd.join(path))
}

/// The spelling of `path` to hand back to the renderer.
///
/// Canonicalization is required for the scope grant, but on Windows it yields an
/// extended-length (`\\?\`) path. That form is a correct filesystem identity and
/// a poor application identity: the dialog plugin gives the renderer the plain
/// spelling, so one file arrives under two names and becomes two tabs and two
/// Recent Files rows. Hand back the plain spelling whenever it is unambiguous.
/// This grants no authority — every renderer path is canonicalized and
/// re-checked against the scope on each use.
pub(crate) fn display_path(path: &Path) -> PathBuf {
    let simplified = dunce::simplified(path);
    match simplified.to_str().and_then(simplify_verbatim_unc) {
        Some(unc) => PathBuf::from(unc),
        None => simplified.to_path_buf(),
    }
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
    fn simplifies_a_plain_verbatim_unc_path() {
        assert_eq!(
            simplify_verbatim_unc(r"\\?\UNC\wsl.localhost\Ubuntu\home\me\notes.md").as_deref(),
            Some(r"\\wsl.localhost\Ubuntu\home\me\notes.md"),
        );
    }

    #[test]
    fn leaves_non_verbatim_unc_input_alone() {
        for input in [
            r"\\server\share\notes.md",
            r"\\?\C:\notes.md",
            "/home/me/notes.md",
            r"\\?\UNC\",
            "",
        ] {
            assert_eq!(simplify_verbatim_unc(input), None, "{input}");
        }
    }

    #[test]
    fn refuses_to_simplify_when_the_plain_form_would_be_reinterpreted() {
        // The verbatim prefix suppresses Windows path normalization. Stripping it
        // is only safe when the remainder survives normalization untouched.
        for input in [
            r"\\?\UNC\server\share\..\escape.md",
            r"\\?\UNC\server\share\.\here.md",
            r"\\?\UNC\server\share\trailing.",
            r"\\?\UNC\server\share\trailing ",
            r"\\?\UNC\server\share\wild*card.md",
            r#"\\?\UNC\server\share\quo"te.md"#,
            r"\\?\UNC\server\\share\empty.md",
        ] {
            assert_eq!(simplify_verbatim_unc(input), None, "{input}");
        }
    }

    #[test]
    fn refuses_to_simplify_a_path_that_needs_the_extended_length_prefix() {
        let long = format!(r"\\?\UNC\server\share\{}.md", "a".repeat(300));
        assert_eq!(simplify_verbatim_unc(&long), None);
    }

    #[test]
    fn display_path_is_identity_for_an_ordinary_absolute_path() {
        let dir = tempdir().expect("tempdir");
        let target = dir.path().join("notes.md");
        assert_eq!(display_path(&target), target);
    }

    #[cfg(windows)]
    #[test]
    fn display_path_returns_the_plain_windows_spelling() {
        // Both extended-length forms canonicalize() can produce must collapse to
        // the spelling a file dialog would hand the renderer, or the same file
        // opens as two tabs.
        assert_eq!(
            display_path(Path::new(r"\\?\C:\notes\a.md")),
            PathBuf::from(r"C:\notes\a.md"),
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\wsl.localhost\Ubuntu\home\me\a.md")),
            PathBuf::from(r"\\wsl.localhost\Ubuntu\home\me\a.md"),
        );
    }

    #[test]
    fn resolve_launch_path_keeps_an_absolute_argument() {
        let dir = tempdir().expect("tempdir");
        let absolute = dir.path().join("notes.md");
        let cwd = Path::new("/definitely/not/used");
        assert_eq!(
            resolve_launch_path(&absolute.to_string_lossy(), cwd).as_deref(),
            Some(absolute.as_path()),
        );
    }

    #[test]
    fn resolve_launch_path_anchors_a_relative_argument_to_the_launching_directory() {
        // A shell can hand either entry point a relative argument; the caller's
        // working directory is the only correct anchor for it.
        let cwd = tempdir().expect("tempdir");
        assert_eq!(
            resolve_launch_path("notes.md", cwd.path()).as_deref(),
            Some(cwd.path().join("notes.md").as_path()),
        );
    }

    #[test]
    fn resolve_launch_path_refuses_parent_traversal_and_empty_arguments() {
        let cwd = tempdir().expect("tempdir");
        assert_eq!(resolve_launch_path("../escape.md", cwd.path()), None);
        assert_eq!(resolve_launch_path("a/../../escape.md", cwd.path()), None);
        assert_eq!(resolve_launch_path("", cwd.path()), None);
    }

    #[cfg(windows)]
    #[test]
    fn display_path_keeps_a_path_that_needs_the_extended_length_prefix() {
        let long = format!(r"\\?\C:\{}\a.md", "d".repeat(300));
        assert_eq!(display_path(Path::new(&long)), PathBuf::from(&long));
    }

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
