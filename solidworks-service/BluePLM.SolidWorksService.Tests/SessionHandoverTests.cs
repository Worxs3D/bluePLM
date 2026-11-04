using Xunit;

namespace BluePLM.SolidWorksService.Tests
{
    /// <summary>
    /// When the service moves off the hidden SolidWorks it launched onto one the user started
    /// later. Holding the hidden handle for the whole session hid every document the user opened,
    /// so checkout never cleared SolidWorks' read-only state on them.
    /// </summary>
    [Trait("Category", "Headless")]
    public class SessionHandoverTests
    {
        [Fact]
        public void A_second_solidworks_beside_our_hidden_one_is_the_users()
        {
            Assert.True(SolidWorksSessionHandover.AnotherSessionIsRunning(true, 27628, new[] { 27628, 33264 }));
        }

        [Fact]
        public void Only_our_hidden_instance_running_needs_no_handover()
        {
            Assert.False(SolidWorksSessionHandover.AnotherSessionIsRunning(true, 27628, new[] { 27628 }));
        }

        [Fact]
        public void An_instance_we_attached_to_is_never_handed_over()
        {
            // The user's own SolidWorks: the service did not start it and must not close it.
            Assert.False(SolidWorksSessionHandover.AnotherSessionIsRunning(false, 0, new[] { 33264, 40000 }));
            Assert.False(SolidWorksSessionHandover.AnotherSessionIsRunning(false, 27628, new[] { 27628, 33264 }));
        }

        [Fact]
        public void An_unknown_pid_or_process_list_means_no_handover()
        {
            Assert.False(SolidWorksSessionHandover.AnotherSessionIsRunning(true, 0, new[] { 33264 }));
            Assert.False(SolidWorksSessionHandover.AnotherSessionIsRunning(true, 27628, null));
        }

        [Fact]
        public void The_lookup_must_return_a_process_other_than_ours()
        {
            Assert.True(SolidWorksSessionHandover.IsUserSession(27628, 33264));
            Assert.False(SolidWorksSessionHandover.IsUserSession(27628, 27628));
            Assert.False(SolidWorksSessionHandover.IsUserSession(27628, 0));
        }
    }
}
