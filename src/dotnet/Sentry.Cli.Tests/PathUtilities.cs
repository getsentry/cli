using System.Runtime.CompilerServices;

namespace Sentry.Cli.Tests;

internal static class PathUtilities
{
    private static readonly Lazy<DirectoryInfo> s_testProjectDirectory = new(() => GetTestProjectDirectory());
    private static readonly Lazy<DotnetProject> s_launcherProject = new(GetLauncherProject);
    private static readonly Lazy<DirectoryInfo> s_artifactsDirectory = new(GetArtifactsDirectory);
    private static readonly Lazy<DirectoryInfo> s_binaryDirectory = new(GetBinaryDirectory);
    private static readonly Lazy<FileInfo> s_packageFile = new(GetPackageFile);

    internal static DotnetProject LauncherProject => s_launcherProject.Value;
    internal static DirectoryInfo ArtifactsDirectory => s_artifactsDirectory.Value;
    internal static DirectoryInfo BinaryDirectory => s_binaryDirectory.Value;
    internal static FileInfo PackageFile => s_packageFile.Value;

    private static DirectoryInfo GetTestProjectDirectory([CallerFilePath] string? sourceFilePath = null)
    {
        var testProjectPath = Path.GetDirectoryName(sourceFilePath);
        Assert.NotNull(testProjectPath);

        FileInfo testProject = new(Path.Combine(testProjectPath, "Sentry.Cli.Tests.csproj"));

        if (!testProject.Exists)
        {
            Assert.Fail($"Test project not found: {testProject}");
        }

        Assert.NotNull(testProject.Directory);
        return testProject.Directory;
    }

    private static DotnetProject GetLauncherProject()
    {
        var testProjectDirectory = s_testProjectDirectory.Value;
        FileInfo project = new(Path.Combine(testProjectDirectory.FullName, "../Sentry.Cli/Sentry.Cli.csproj"));

        if (!project.Exists)
        {
            Assert.Fail($"Launcher project not found: {project}");
        }

        return new DotnetProject(project);
    }

    private static DirectoryInfo GetArtifactsDirectory()
    {
        var testProjectDirectory = s_testProjectDirectory.Value;
        DirectoryInfo artifacts = new(Path.Combine(testProjectDirectory.FullName, "../artifacts"));

        if (!artifacts.Exists)
        {
            Assert.Fail($"Artifacts path not found: {artifacts}");
        }

        return artifacts;
    }

    private static DirectoryInfo GetBinaryDirectory()
    {
        var testProjectDirectory = s_testProjectDirectory.Value;
        DirectoryInfo binary = new(Path.Combine(testProjectDirectory.FullName, "../../../dist-bin"));

        if (!binary.Exists)
        {
            Assert.Fail($"Binary path not found: {binary}");
        }

        return binary;
    }

    private static FileInfo GetPackageFile()
    {
        var testProjectDirectory = s_testProjectDirectory.Value;
        FileInfo package = new(Path.Combine(testProjectDirectory.FullName, "../../../package.json"));

        if (!package.Exists)
        {
            Assert.Fail($"Package JSON not found: {package}");
        }

        return package;
    }
}
