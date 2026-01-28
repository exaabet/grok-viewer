Grok Viewer is a lightweight Chrome extension designed to view, track, and manage MP4 videos generated on Grok Imagine.

The extension focuses exclusively on video content and provides a clean, minimal interface for browsing both newly generated and previously created videos without interfering with the normal Grok workflow.

It integrates directly with the Grok Imagine experience and allows users to:
Monitor video generation in real time
Access all previously generated videos from the Favorites page
Browse videos in a dedicated, distraction-free viewer
Perform basic management operations such as refreshing, downloading, and deleting videos
The extension operates using the active Grok session and does not require external authentication or API keys.

Features
Real-time video detection
Grok Viewer detects newly generated MP4 videos during the generation process and adds them to the viewer as soon as they become available.
Favorites integration
The extension retrieves all video content from the Grok Favorites page (https://grok.com/imagine/favorites) and supports pagination to ensure the full video history is accessible.
Viewer interface
Videos are displayed in a grid-based layout with a dedicated lightbox player. Keyboard navigation is supported for moving between videos and closing the viewer.
Refresh and live updates
A manual refresh option is available, and the extension periodically checks for new videos on the Favorites page to keep the list up to date.
Video management

The extension supports:
Downloading individual videos
Downloading all available videos
Deleting individual videos
Deleting all videos in bulk, with rate-limit handling

Technical notes

The extension runs entirely within the user's active Grok session and relies on existing browser cookies for authentication.
Network requests are executed from the page context to ensure compatibility with Grok’s session and security model.
Only MP4 video content is processed; images and other media types are intentionally ignored.

Installation
Clone or download the repository.
Open Chrome and navigate to chrome://extensions.
Enable Developer Mode.
Click “Load unpacked” and select the project directory.
Navigate to Grok Imagine to begin using the extension.

Scope and limitations
Grok Viewer is intended for personal use and operates only on content accessible to the logged-in user. The extension does not modify Grok content beyond user-initiated actions such as deletion.
