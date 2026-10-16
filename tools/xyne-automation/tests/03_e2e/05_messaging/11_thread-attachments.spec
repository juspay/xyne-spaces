# Thread Attachments E2E Flow
> Attach files to thread replies and check what each participant sees (TH-16 in docs/test-plans/chat-threads.md).
> Sample files live in fixtures/files.

## Admin attaches an image to a thread reply and User1 sees the preview
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-1"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for an image reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-attachment" with text "Reply with an image" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-attachment" in "[data-testid='thread-panel'] [data-testid='message-input']"
* Attaching fixture file "sample-image.png" to the open thread reply
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-attachment" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "img[alt='sample-image.png']" is visible on stored user "admin-1" channel "channel-1" message "message-attachment" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* switching to temp browser "user1-browser-1"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* verifying "img[alt='sample-image.png']" is visible on stored user "admin-1" channel "channel-1" message "message-attachment" in "[data-testid='thread-panel'] [data-component='ThreadList']"

## Admin attaches several files to one thread reply and User1 sees all of them
* Using browser
* Logging in user "user-1" on temp browser "user1-browser-1"
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for a multi-file reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-attachments" with text "Reply with several files" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-testid='message-input']"
* Attaching fixture file "sample-image.gif" to the open thread reply
* Attaching fixture file "sample-notes.txt" to the open thread reply
* Attaching fixture file "sample-archive.zip" to the open thread reply
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-attachments" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "img[alt='sample-image.gif']" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "text=sample-notes.txt" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "text=sample-archive.zip" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* switching to temp browser "user1-browser-1"
* Opening channel thread on stored user "admin-1" message "message-thread-root" in channel "channel-1" for user "user-1"
* verifying "img[alt='sample-image.gif']" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "text=sample-notes.txt" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"
* verifying "text=sample-archive.zip" is visible on stored user "admin-1" channel "channel-1" message "message-attachments" in "[data-testid='thread-panel'] [data-component='ThreadList']"

## A CSV attached to a thread reply shows as an inline table
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for a CSV reply" in channel "channel-1" for user "admin-1"
* generating net-new message details "message-csv" with text "Reply with a CSV" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* typing stored user "admin-1" channel "channel-1" message "message-csv" in "[data-testid='thread-panel'] [data-testid='message-input']"
* Attaching fixture file "sample-data.csv" to the open thread reply
* clicking on "[data-testid='thread-panel'] [data-testid='send-message-button']"
* Verifying stored message "message-csv" in channel "channel-1" for user "admin-1" is visible in open thread
* verifying "[data-testid='inline-csv-preview']:has-text('Platform')" is visible on stored user "admin-1" channel "channel-1" message "message-csv" in "[data-testid='thread-panel'] [data-component='ThreadList']"

## A blocked file type is rejected from a thread reply
* Using browser
* Ensuring user "admin-1" is logged in
* Posting thread root "message-thread-root" with text "Thread root for a blocked file" in channel "channel-1" for user "admin-1"
* Opening thread on stored message "message-thread-root" in channel "channel-1" for user "admin-1"
* attaching fixture file "blocked-file.exe" to "[data-testid='thread-panel'] input[type='file']"
* verifying "File upload rejected" is visible in "body"
* verifying "[data-testid='thread-panel'] [data-testid='attachment-preview']" is not visible
