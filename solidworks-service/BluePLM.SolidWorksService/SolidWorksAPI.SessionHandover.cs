using System;
using System.Linq;
using SolidWorks.Interop.sldworks;

namespace BluePLM.SolidWorksService
{
    /// <summary>
    /// The decisions behind handing over from the hidden SolidWorks BluePLM launched to one the
    /// user started later. Pure, so they are tested without SolidWorks.
    /// </summary>
    public static class SolidWorksSessionHandover
    {
        /// <summary>
        /// True when the service holds a hidden SolidWorks it launched itself and some other
        /// SLDWORKS.exe is running too, which can only be one the user started.
        /// </summary>
        public static bool AnotherSessionIsRunning(bool weStartedSw, int ourPid, int[]? runningPids)
        {
            if (!weStartedSw || ourPid <= 0 || runningPids == null) return false;
            return runningPids.Any(pid => pid > 0 && pid != ourPid);
        }

        /// <summary>
        /// True when the instance a running-object-table lookup returned is not the hidden one,
        /// so it is the user's. A PID that could not be read (0) is never taken as the user's.
        /// </summary>
        public static bool IsUserSession(int ourPid, int attachedPid)
        {
            return attachedPid > 0 && attachedPid != ourPid;
        }
    }

    public partial class SolidWorksAPI
    {
        // Every command passes through the check, so it is throttled; a failed attach (for
        // example SolidWorks running at another integrity level) backs off for longer, because a
        // failing ROT lookup can take seconds.
        private const int HandoverCheckIntervalMs = 2000;
        private const int HandoverRetryAfterFailureMs = 30000;
        private DateTime _handoverNextCheckUtc = DateTime.MinValue;

        /// <summary>
        /// Switch from the hidden SolidWorks this service launched to the one the user started
        /// after it, and close the hidden one.
        ///
        /// The warmup launches a hidden SolidWorks when none is running, and the cached handle
        /// then kept pointing at it for the rest of the session. A SolidWorks the user opened
        /// later was invisible to every live-document command: getOpenDocuments reported none of
        /// its documents, so checkout never called SetReadOnlyState and a part opened read-only
        /// stayed read-only in SolidWorks however often it was checked out. The hidden instance
        /// does not register in the running object table; the user's does, so a fresh lookup
        /// finds it.
        ///
        /// Called by the command loop between commands, never inside one, so no command is
        /// using the hidden instance when it is closed.
        /// </summary>
        public void HandOverToUserSolidWorksIfNeeded()
        {
            if (!_weStartedSW || _swApp == null || _launchedProcessId <= 0) return;

            var now = DateTime.UtcNow;
            if (now < _handoverNextCheckUtc) return;
            _handoverNextCheckUtc = now.AddMilliseconds(HandoverCheckIntervalMs);

            if (!SolidWorksSessionHandover.AnotherSessionIsRunning(_weStartedSW, _launchedProcessId, GetSolidWorksProcessIds()))
                return;

            ISldWorks? userApp = null;
            var attachedPid = 0;
            try
            {
                userApp = GetActiveObjectOnSTA() as ISldWorks;
                if (userApp != null) attachedPid = userApp.GetProcessID();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[SW-API] Handover: lookup of the user's SolidWorks failed: {ex.Message}");
            }

            if (userApp == null || !SolidWorksSessionHandover.IsUserSession(_launchedProcessId, attachedPid))
            {
                Console.Error.WriteLine(
                    $"[SW-API] Handover: another SolidWorks is running but could not be attached " +
                    $"(found pid {attachedPid}, ours {_launchedProcessId}); retrying in {HandoverRetryAfterFailureMs / 1000}s");
                _handoverNextCheckUtc = now.AddMilliseconds(HandoverRetryAfterFailureMs);
                return;
            }

            try
            {
                // Still starting up: attach next time, once it can take commands.
                if (!userApp.StartupProcessCompleted) return;
            }
            catch
            {
                return;
            }

            var hidden = _swApp;
            var hiddenPid = _launchedProcessId;
            Console.Error.WriteLine($"[SW-API] Handover: attaching to the user's SolidWorks (pid {attachedPid}) and closing the hidden instance (pid {hiddenPid})");

            _swApp = userApp;
            _weStartedSW = false;
            MarkComAvailable();

            // The hidden instance holds no user work: it has no window and no user control.
            try { hidden.CloseAllDocuments(true); } catch { }
            try { hidden.ExitApp(); } catch (Exception ex) { Console.Error.WriteLine($"[SW-API] Handover: ExitApp on the hidden instance failed: {ex.Message}"); }

            // Hands the PID back to the host, whose watchdog cleans it up if ExitApp did not.
            ReleaseLaunchedProcess();
        }
    }
}
