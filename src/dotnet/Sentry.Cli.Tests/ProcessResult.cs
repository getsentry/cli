namespace Sentry.Cli.Tests;

internal sealed class ProcessResult
{
    private readonly int _exitCode;
    private readonly string _output;
    private readonly string _error;

    public ProcessResult(int exitCode, string output, string error)
    {
        _exitCode = exitCode;
        _output = output;
        _error = error;
    }

    public int ExitCode => _exitCode;
    public string Output => _output;
    public string Error => _error;

    public async Task AssertSuccessAsync()
    {
        await Assert.That(_exitCode).IsZero();
    }

    public async Task AssertFailureAsync()
    {
        await Assert.That(_exitCode).IsNotZero();
    }

    public async Task AssertFailureAsync(int exitCode)
    {
        await Assert.That(_exitCode).IsEqualTo(exitCode);
    }

    public async Task AssertOutputAsync(string output)
    {
        await Assert.That(_output).IsEqualTo(output);
        await Assert.That(_error).IsEmpty();
    }

    public async Task AssertErrorAsync(string error)
    {
        await Assert.That(_output).IsEmpty();
        await Assert.That(_error).IsEqualTo(error);
    }
}
