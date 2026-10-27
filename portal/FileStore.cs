namespace Portal;

public record FileEntry(string Name, string Path, bool IsFolder, long Size, DateTimeOffset Modified);

/// <summary>Document library on disk. Every path is resolved under the root, so "../" can't escape it.</summary>
public class FileStore(string root)
{
    public string Root { get; } = Directory.CreateDirectory(root).FullName;

    public string Resolve(string? relative)
    {
        var full = System.IO.Path.GetFullPath(System.IO.Path.Combine(Root, (relative ?? "").TrimStart('/', '\\')));
        if (full != Root && !full.StartsWith(Root + System.IO.Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new UnauthorizedAccessException("Path is outside the library.");
        return full;
    }

    public string Relative(string full) => System.IO.Path.GetRelativePath(Root, full).Replace('\\', '/');

    public IEnumerable<FileEntry> List(string? folder)
    {
        var dir = new DirectoryInfo(Resolve(folder));
        if (!dir.Exists) throw new DirectoryNotFoundException();
        foreach (var d in dir.EnumerateDirectories().OrderBy(d => d.Name))
            yield return new FileEntry(d.Name, Relative(d.FullName), true, 0, d.LastWriteTimeUtc);
        foreach (var f in dir.EnumerateFiles().OrderBy(f => f.Name))
            yield return new FileEntry(f.Name, Relative(f.FullName), false, f.Length, f.LastWriteTimeUtc);
    }

    /// <summary>Strips directories and characters that are unsafe in file names.</summary>
    public static string CleanName(string name)
    {
        var n = System.IO.Path.GetFileName(name.Replace('\\', '/'));
        foreach (var c in System.IO.Path.GetInvalidFileNameChars()) n = n.Replace(c, '_');
        n = n.Trim().TrimStart('.');
        if (n.Length == 0) throw new ArgumentException("Invalid name.");
        return n.Length > 120 ? n[..120] : n;
    }

    public (int Files, long Bytes) Totals()
    {
        var files = new DirectoryInfo(Root).EnumerateFiles("*", SearchOption.AllDirectories).ToList();
        return (files.Count, files.Sum(f => f.Length));
    }
}
