using System.Collections.Concurrent;
using BluePLM.EDrawingsPreviewHost;

var testDirectory = Path.Combine(Path.GetTempPath(), $"blueplm-status-{Guid.NewGuid():N}");
Directory.CreateDirectory(testDirectory);
long reportedSuccessfulReads = 0;
long reportedSuccessfulOverlappingReads = 0;

try
{
    var statusPath = Path.Combine(testDirectory, "preview.status");
    const string firstStatus = "handshake 12345";
    const string secondStatus = "ready 12345 Boolean:True";
    File.WriteAllText(statusPath, firstStatus);

    var unexpectedReads = new ConcurrentQueue<string>();
    using var stopReading = new CancellationTokenSource();
    var start = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var readerStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var writerStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var firstSuccessfulRead = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    long statusWriteEpoch = 0;
    long successfulReads = 0;
    long successfulOverlappingReads = 0;
    var reader = Task.Run(() =>
    {
        readerStarted.TrySetResult();
        start.Task.WaitAsync(TimeSpan.FromSeconds(10)).GetAwaiter().GetResult();
        while (!stopReading.IsCancellationRequested)
        {
            var readEpoch = Volatile.Read(ref statusWriteEpoch);
            try
            {
                using var stream = new FileStream(
                    statusPath,
                    FileMode.Open,
                    FileAccess.Read,
                    FileShare.ReadWrite | FileShare.Delete);
                using var reader = new StreamReader(stream);
                var content = reader.ReadToEnd();
                if (content != firstStatus && content != secondStatus)
                {
                    unexpectedReads.Enqueue(content);
                }
                else
                {
                    var completedAtEpoch = Volatile.Read(ref statusWriteEpoch);
                    Interlocked.Increment(ref successfulReads);
                    if (WriteOverlappedRead(readEpoch, completedAtEpoch))
                    {
                        Interlocked.Increment(ref successfulOverlappingReads);
                    }
                    firstSuccessfulRead.TrySetResult();
                }
            }
            catch (Exception error) when (
                IsTransientStatusReadFailure(
                    error,
                    readEpoch,
                    Volatile.Read(ref statusWriteEpoch)))
            {
                // Atomic replacement can briefly remove or deny access to the destination.
                // Match only known transient Win32 errors whose read attempt overlapped a write.
            }
        }
    });

    await readerStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
    var writer = Task.Run(async () =>
    {
        writerStarted.TrySetResult();
        await start.Task.WaitAsync(TimeSpan.FromSeconds(10));
        for (var index = 0; index < 500; index++)
        {
            Interlocked.Increment(ref statusWriteEpoch);
            try
            {
                HostStatusFile.Write(
                    statusPath,
                    index % 2 == 0 ? "ready" : "handshake",
                    12345,
                    index % 2 == 0 ? "Boolean:True" : null);
            }
            finally
            {
                Interlocked.Increment(ref statusWriteEpoch);
            }
        }
    });
    await writerStarted.Task.WaitAsync(TimeSpan.FromSeconds(10));
    start.TrySetResult();
    await firstSuccessfulRead.Task.WaitAsync(TimeSpan.FromSeconds(10));
    await writer.WaitAsync(TimeSpan.FromSeconds(10));
    stopReading.Cancel();
    await reader.WaitAsync(TimeSpan.FromSeconds(10));
    if (Interlocked.Read(ref successfulReads) == 0)
    {
        throw new InvalidOperationException("The concurrent status reader never completed a successful read.");
    }
    if (Interlocked.Read(ref successfulOverlappingReads) == 0)
    {
        throw new InvalidOperationException("No successful read overlapped the atomic-write lifecycle.");
    }
    if (!unexpectedReads.IsEmpty)
    {
        throw new InvalidOperationException(
            $"A reader observed a partial status value: {unexpectedReads.FirstOrDefault()}");
    }
    if (File.ReadAllText(statusPath) != firstStatus)
    {
        throw new InvalidOperationException("The final status value was not readable after replacement stopped.");
    }

    var temporaryFiles = Directory.GetFiles(testDirectory, ".preview.status.*.tmp");
    if (temporaryFiles.Length != 0)
    {
        throw new InvalidOperationException("Atomic status publication left a sibling temporary file behind.");
    }
    reportedSuccessfulReads = Interlocked.Read(ref successfulReads);
    reportedSuccessfulOverlappingReads = Interlocked.Read(ref successfulOverlappingReads);

    var missingDirectoryPath = Path.Combine(testDirectory, "missing", "preview.status");
    try
    {
        HostStatusFile.Write(missingDirectoryPath, "ready", 12345);
        throw new InvalidOperationException("Status publication unexpectedly swallowed its write failure.");
    }
    catch (DirectoryNotFoundException)
    {
        // Expected: publication errors remain observable by the host.
    }
}
finally
{
    Directory.Delete(testDirectory, recursive: true);
}

static bool IsTransientStatusReadFailure(Exception error, long readEpoch, long currentWriteEpoch) =>
    WriteOverlappedRead(readEpoch, currentWriteEpoch) &&
    (error is FileNotFoundException ||
        (error is IOException ioError && (ioError.HResult & 0xFFFF) == 32) ||
        (error is UnauthorizedAccessException accessError && (accessError.HResult & 0xFFFF) == 5));

static bool WriteOverlappedRead(long readEpoch, long currentWriteEpoch) =>
    (readEpoch & 1) != 0 ||
    (currentWriteEpoch & 1) != 0 ||
    readEpoch != currentWriteEpoch;

if (!IsTransientStatusReadFailure(new FileNotFoundException(), 0, 2) ||
    IsTransientStatusReadFailure(new FileNotFoundException(), 0, 0) ||
    !IsTransientStatusReadFailure(new IOException("Sharing violation", 32), 0, 2) ||
    IsTransientStatusReadFailure(new IOException("Sharing violation", 32), 0, 0) ||
    !IsTransientStatusReadFailure(new HarnessUnauthorizedAccessException(5), 0, 2) ||
    !IsTransientStatusReadFailure(new HarnessUnauthorizedAccessException(5), 1, 1) ||
    IsTransientStatusReadFailure(new HarnessUnauthorizedAccessException(5), 0, 0) ||
    IsTransientStatusReadFailure(new HarnessUnauthorizedAccessException(6), 0, 2) ||
    IsTransientStatusReadFailure(new IOException("Unexpected I/O failure", 5), 0, 2))
{
    throw new InvalidOperationException("The status-reader retry filter accepted an unexpected error.");
}

Console.WriteLine(
    $"Atomic status-file harness passed ({reportedSuccessfulReads} complete reads, {reportedSuccessfulOverlappingReads} overlapping writes).");

sealed class HarnessUnauthorizedAccessException : UnauthorizedAccessException
{
    public HarnessUnauthorizedAccessException(int hresult)
    {
        HResult = hresult;
    }
}
