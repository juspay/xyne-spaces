## [1.171.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.170.0...v1.171.0) (2026-06-25)


### Features

* add project views ([246773f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/246773f5c8045b3d782812bbfd18bd50250dd69d)), closes [#7992](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7992)
* bot name resolution, stale cron cleanup, and resume-from-lastSyncedDate ([08828c4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/08828c47d2b09573414254c2e2d1bd335f163a34)), closes [#7225](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7225)
* remove deactivated users from all groups and assignment state ([2d36227](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2d362272bab2d098886a2df30b37963cf3278422)), closes [#7786](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7786)
* sam default channel integration ([f482d57](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f482d57d331d38752d715ad416686d272a4086f0)), closes [#8011](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8011)
* selective participants in scheduled call in a channel" - Revert "Pull request [#7737](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7737): ([cdccb9e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdccb9e060acb9d3ffab71bcf1bda468b125d2f5)), closes [#8038](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8038)


### Bug Fixes

* attachment preview error for file type docx was broken ([40e2f68](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/40e2f6872624ebada9523268fcf4cee72d5fc8b6)), closes [#7647](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7647)
* claw automation fix (backport) ([846e9ce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/846e9ce9627b616f4f92b91093f64ff1040169dd))
* cmdK regular channel affinity ([f3bb26d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f3bb26d64188af02eee7f71327941f1dfefeab5d)), closes [#7995](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7995)
* Desk and Sidebar AI UX fixes ([9ada975](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ada975d90796896ae42ff16e36ccc6bf79150a2)), closes [#8026](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8026)
* Fix Dark Mode message for Call ([93793e8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/93793e80098d44d1735c2ebc4adbae6d7e0bb723))
* fix reactions on fwded messages ([5219afc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5219afc7c85497c75eb92c4f834e3da8bfaa8c5f))
* fixes 1k character limit for group-dm creation ([1da46e7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1da46e7cc89ca174f9996eae78b8709ff2383079))
* Remove boldness from active chat items ([7605948](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/760594828366f9dd5b922a7b105ce5da2fd377c0)), closes [#7998](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7998)
* removing all teh commented code ([51cb79a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/51cb79a94da8c1d945bc38c5b98af495c2bf8798)), closes [#8035](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8035)
* vespa code cleanup ([4f3c466](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4f3c466e61807cb144792dafef78deef593e24df)), closes [#7962](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7962)

## [1.170.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.169.2...v1.170.0) (2026-06-25)


### Features

* add Cmd+K Open/Search ghost hint with inline name completion ([c99cf38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c99cf38ed529b9263e4ce9f0376371be6ccba997)), closes [#8015](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8015)
* add kb_get_chunks + kb_search_within backend+dashboard ([007c240](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/007c24057a91dd862f627e982c17d585b55baa19)), closes [#8016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8016)
* added kb scoping in ask ai + vespa query in debug ([0d2320c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0d2320c897d311f110544d346233a354cc95099f)), closes [#7983](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7983)
* centralize new user creation accesses ([ac594fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ac594fb2d0739444ba50e1bd87bc9571a7f7b78c)), closes [#7812](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7812)
* domain check removed on DL type desks ([e2ed39a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2ed39a4d4317725024a41a5113b57d3ea5fad4a)), closes [#7370](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7370)
* implements search in channel icon in channel header(ticketId: 12533) ([46e1514](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/46e15144dad0c7b6237dcae8557d1554f51e02de)), closes [#8019](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8019)
* Revert "Pull request [#7479](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7479): keyword notifications" ([aa66e65](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aa66e6540954c23da6c5a9f2a0cbc25883aaf4c8)), closes [#8005](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/8005)


### Bug Fixes

* Fix stage approval uploaded document issue ([874637a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/874637a3d0dd7a4dfd7b4745a33e5aaeff897594))
* hooks related code-cleanup ([76b89dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76b89dcaddfa0327d7647cb09cd608a8094da3fc)), closes [#7970](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7970)
* ingestion related code cleanup ([fea971e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fea971e9987325e60afa5ccc54680d22aa659e52)), closes [#7960](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7960)
* stop pasted link fragment from hijacking Cmd K search. ([5714979](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5714979692eae762feb161010fb1ef0910814f4e)), closes [#7997](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7997)

## [1.169.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.169.1...v1.169.2) (2026-06-24)


### Bug Fixes

* citation url of mail ([c133856](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c133856249266a5a6bbcbb94a65dc9af6b34330c)), closes [#7938](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7938)
* Clean up UI related codebase ([636a1c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/636a1c25dcdf8e686cf2a2d21e18c9ec17560407)), closes [#7965](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7965)
* Delete a call from calendar ([722939e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/722939e6a2db7ef141558d9bfdcdd777986389ff)), closes [#7977](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7977)

## [1.169.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.169.0...v1.169.1) (2026-06-24)


### Bug Fixes

* adding tickettype and labels as board config ([48d4f2a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48d4f2ad40759714956e740a54a519ee790f25ca)), closes [#7974](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7974)

## [1.169.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.168.0...v1.169.0) (2026-06-23)


### Features

* add form field conditions to ticket-updated automation trigger ([293e739](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/293e739900ed545ee5b369e0d1420d9071e61186)), closes [#7907](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7907)
* added support to attach doc in forms ([99beebd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/99beebd17efce15e51a76a2441f1e64489413247)), closes [#7740](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7740)
* ask-ai ([e757e08](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e757e08d4ca45bd5a14cbbfdb12c7be1c440986c)), closes [#7929](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7929)
* channel level email implementations ([d950c9b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d950c9b78f8cbb4d44fbe63eb5fd1b18f3092e66)), closes [#7909](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7909)
* implemented older email sync - desk ([8a67475](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8a67475b7d1e3ab1381176386dddf7574da5b317)), closes [#7866](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7866)
* optimizing replies_md update ([ce41209](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ce41209e438e1d2e13b64a6fab7f45db7eb2ec07)), closes [#7493](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7493)
* PDF Zoom - Desktop ([637b6e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/637b6e9362b78a99e7b9e2ceda5ab5612d48ee02)), closes [#7905](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7905)
* ticket api move to xyneId for get ([4fdabb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4fdabb6aa38489606f34939494c4ad09b9790625)), closes [#7971](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7971)


### Bug Fixes

* AskAI related code cleanup ([d5d6fc9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d5d6fc927e4274f8e84c28ca1ef6f120a712832f)), closes [#7956](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7956)
* default search to All and make Cmd+F honor screen mode ([b142945](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b1429457ebc941a51fa42692a17601c5aef595af)), closes [#7742](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7742)
* Exposed Attachment path for cli ([c87db2d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c87db2d19278630cd5c045eea3f37f7a862b0251)), closes [#7935](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7935)
* Hide PR/QA filters when board tickets lack those roles ([b565eb7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b565eb7de4bcf4b19ce770e6000cf63c29c47ca7)), closes [#7852](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7852)
* Move form permission check from mutator to ACLs with FORMS resource ADMIN ([6a79fe5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6a79fe530a8f48beabe4cc290fe52c1544517cc2)), closes [#7961](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7961)
* remove generic error message in toast ([1513be2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1513be27514affd0949891d582e01ed01502a1a2)), closes [#7823](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7823)
* slack migration code cleanup ([2280c91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2280c916b986417214fffce1bdaac806f48dbca6)), closes [#7903](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7903)
* userGroup related code cleanup ([4c7052f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c7052f11aafc62ed6a22909150031bc5e83bdea)), closes [#7958](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7958)

## [1.168.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.167.0...v1.168.0) (2026-06-23)


### Features

* added unreads section for messages ([3702e32](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3702e32d70c5836b4f68d0da4336cc42fb4e4d22)), closes [#7891](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7891)

## [1.167.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.166.0...v1.167.0) (2026-06-22)


### Features

* [XYNE-DESK] add per-channel AI retrigger button and fix inbox owner search ([74368cb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/74368cb6bf9e6a91661086f5598e8255a82da075))
* add Cmd+K affinity-based DM ranking ([a70d53f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a70d53f2180c77844b3c941bb6cd2a1d6791b8bd)), closes [#7750](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7750)
* add onlyFirstReply checkbox to EMAIL_SENT trigger ([99d50b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/99d50b818051c528f9954c36d62d5efda3383c75)), closes [#7741](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7741)
* added generate, edit msgs which creates branches ([6d870a6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d870a6eb2dbcacec1bfda1fe12defd66534bba1)), closes [#7870](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7870)
* colaborating call canvas ([de64000](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/de640004afde6ddf4c27a7a5b6921df65fe2e294)), closes [#7821](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7821)
* improve chatlist virtualizer by using tanstack ([5d6dac1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d6dac11e385b72647acc4d6ffc9a9454bb56de0)), closes [#7486](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7486)
* keyword notifications ([2cc6255](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2cc6255b156c0641869fdeacfae57b8ffd838f47)), closes [#7479](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7479)
* new ticket in kanban columns + groupby changes ([73cffd2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/73cffd21a79e82fa412c68ca53685a0d0ff24dee)), closes [#7807](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7807)
* team intelligence prompt changes for summary generation ([98d8d73](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/98d8d73647811c65de2d920f89233b233d947e34)), closes [#7856](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7856)


### Bug Fixes

* [XYNE-DESK] Inline Image and Attachments issue ([d6857b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d6857b8b1199b459a82c3c1184407a425ba7a15f)), closes [#7705](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7705)
* add inline code shortcut - cmd+shift+C ([5fa6834](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5fa6834e6d55b3d683d878d483100b707ba0e6c4)), closes [#7857](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7857)
* cache electron logger serial number ([3ba3965](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3ba3965a85c3ff05567bf30455cb109747455359)), closes [#7371](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7371)
* canvas related code cleanup ([ca50d53](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ca50d53ac03a1079762af2ff66eb10ae7e912dd5)), closes [#7876](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7876)
* draft citations fixes ([31ad6c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/31ad6c35353b6095c08660ee7ab98c60f9ac9814)), closes [#7772](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7772)
* fix ([15cf519](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/15cf5194474a40cf2c3ac42cae50961461ca6b84)), closes [#7880](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7880)
* Fix blockit FlowJSON attachment rendering for table ([82c144c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/82c144cda64777ddd00699eabcdcca492bb3f606))
* Fix Xyne Bot not found error handling ([8954913](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8954913203d30660173bd510f34c559f1a9176c5))
* keep ask ai sidebar stream alive for claw agents ([d441647](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d441647063f13e9b93fd9b405bff1c2cb61020ff)), closes [#7853](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7853)
* route QA alerts by failure category ([0551395](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0551395e00870eb0ceeddc01ccc999905abf4b78)), closes [#7781](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7781)
* ticket related code cleanup ([5b2a550](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b2a550bd2fff063245c3ac230bc7e74049d02e3)), closes [#7692](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7692)

## [1.166.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.165.0...v1.166.0) (2026-06-20)


### Features

* Add Ask AI launch page with SEBI + KB ([532c744](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/532c744d2d3599f259bb42a0455ee8a3c395e135)), closes [#7655](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7655)

## [1.165.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.164.0...v1.165.0) (2026-06-19)


### Features

* add from: to: filters in xyne desk search ([ecdaa83](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ecdaa837b153cc6216e68addef80e5f48c02bd0f)), closes [#7642](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7642)
* add logs for grafana dashboard for call, canvas, tickets data ([21be9ea](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/21be9eaf652e8d0ccdb850f45627f7f8054200ba)), closes [#7738](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7738)
* added support for claw to access kb ([ddb80e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ddb80e91332717b374b70ad16eefddf7c1e8c882)), closes [#7756](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7756)
* app ticket endpoints ([50c2237](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/50c22370c09356d4100b7983ae9234b0dd3131e1)), closes [#7788](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7788)
* async OCR scheduler with PDF fallback ingestion ([4576dac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4576dacdd925bfdaa5c02a60e41d697d52f4fa21)), closes [#7504](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7504)
* bulk-whatsapp-migration ([6ad224d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6ad224de9d4783fbb8f6bbc6faedc0989a8b5c88)), closes [#7754](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7754)
* changes for this fix of schema.prisma ([032b7f3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/032b7f379b6e92a3e982cc473b167ecfdd023b2e))
* prevent stale IDB cache from overriding fresh cursor data ([a47fed7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a47fed7346e07b729f6c2c3b5819841bda9eb5cf)), closes [#7776](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7776)
* request to join thread calls ([04d5783](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/04d578376285b6e83c7034f8c014cee792b8ca62)), closes [#7748](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7748)
* selective participants in scheduled call in a channel ([250ef5d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/250ef5d3282b0dc24fb2e3cddbb7febc00aafebb)), closes [#7737](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7737)
* ticketNotifications ([08475e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/08475e4edb2754479665b1ea3bdc7445dbf86e7d)), closes [#7690](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7690)


### Bug Fixes

* added sanity for markdown messages and blocked system access through electron apis ([82ce876](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/82ce876a0b160c40533a74d477abd0f2f6c24754)), closes [#7689](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7689)
* channel navigation in recap ([e1c1af0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e1c1af08720bca1d553c95d091747a1bec5301aa)), closes [#7717](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7717)
* dark mode ongoing call banner — add dark variants for bg-green-100 ([6bcc6bf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6bcc6bf7a17f2dcf9ad23fb47f40f211479b0162)), closes [#7739](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7739)
* docker build fix ([d591e93](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d591e9309c81eec9b7c62e363826f6682d728ce7)), closes [#7827](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7827)
* enabling thread replyAt update for pcpt in dms too ([f71712b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f71712b2a48f563ceff3b2b7464bd60be8373593)), closes [#7798](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7798)
* fix channel name overflow in channel modal ([37a503a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/37a503a4c856871856baa20b22c16ceba85ceae6))
* fix null return for channels for fallback ([05176f0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/05176f057fa89eca1d1a64a323aece3cc934d1d3))
* fix settings issue ([c78d0dd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c78d0dd464ec4ec1111644dd295fc27570d94bd3))
* fix settings issue ([ef47b5a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ef47b5aa8e7539452f4911863014a29f26ed5f10))
* fixes workflow-type dropdown transparent in dark mode ([643edb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/643edb64e912a6abdaee475cf07601907698fbe1))
* harden vespaSearch against YQL injection via [@param](https://ssh.bitbucket.juspay.net/param) binding ([9ee9318](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ee93180be9eb16469697851d91148cf2e207c0e)), closes [#7681](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7681)
* hide deactivated users in @ mention ([95d0382](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95d0382498927c65e246d20806f83c1b9ac2e639)), closes [#6883](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6883)
* migration hotfix not using default timestamp ([03ce2c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/03ce2c36212dd25b4792dfcb9168d174b092e6c0))
* navbar broken in mweb ([1898e7a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1898e7a7dde1c7f1ca69d52d898e237e9beb430a)), closes [#7702](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7702)
* optimised time and fixed search ([da5cbee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/da5cbeedaeb947814b5fa545fb42b8007b9af891))
* Push FE console errors ([d2efc0c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d2efc0c12be5b2e556d2782d061fdf112b0dde3d)), closes [#7773](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7773)
* remove db on logout, logout on connection failure modal ([c827141](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c827141b3d7c458c30a7486a3234c5fea945d005)), closes [#7711](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7711)
* remove duplicate tags message ([4a710bf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a710bf982e9be2f99513fc0bcf485bcecee20dc)), closes [#7749](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7749)
* scripts for backfilling ([54dceb8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/54dceb89f2759b14b294dcdab6ac42ccbeff086a)), closes [#7626](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7626)
* shortcut for calls audio and video toggle ([4e02b29](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4e02b29dfe911fff3345fb92fdd584539c70053f)), closes [#7721](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7721)
* show ellipsis for long channel and group DM names in collapsed view ([dbdefc7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dbdefc72ba52d978d8bc75f5c557b8ecb4fb9632)), closes [#7669](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7669)
* temp block og preview image rendering ([7365b05](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7365b0557b9e801231b923a6ab333006efae26f1)), closes [#6484](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6484)
* Xyne Call Feature for lateral inversion fix of video (straight) ([4c8491d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c8491d18baa1709cc9ef4ace17fa8304df969c5))

## [1.164.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.163.1...v1.164.0) (2026-06-17)


### Features

* channel recap table changes fix for team intelligence ([b037def](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b037def47c697cf47232d315e5f819edeab3297b))
* claw stream and cancel ([81258ce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/81258ce182e2990d2c5f00fde36823cd19906480)), closes [#7651](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7651)
* first prototype ([8603171](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/860317193fdb63d464b641a612ab9747b511f51e)), closes [#7573](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7573)
* whatsapp migration ([dc500a8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc500a8dd6db8922ae074e6d65a125cb94316709)), closes [#7641](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7641)


### Bug Fixes

* default Cmd+K and full-page search to "Only my channels" ([2e79319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2e793193a4e4bb640cb33aeab545a1c38b3e90fe)), closes [#7634](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7634)
* drop DB default on conversations.doNotPostToChannel ([95c7d3e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95c7d3efd61ef99266a676b404597d716e72359c)), closes [#7665](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7665)
* Error propagation fix and scroll fix ([60d6768](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/60d676841481037a54afd60ca9851db83c4435d5))
* Fixing the cc issue for desk emails ([d24577d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d24577d1b74f6de32508e0a7e66d8045d2c96bc0))
* generic variable ([a5563e2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5563e23598e550a0f43d1f395b6c59b7d0c2b27)), closes [#7592](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7592)
* parallalize ops in message send mutation ([6dfa8f6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6dfa8f6780bba3618189e8056bfe78427442218b)), closes [#7653](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7653)

## [1.163.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.163.0...v1.163.1) (2026-06-17)


### Bug Fixes

* Fix white text visibility on call screen bottom left ([d4ae36e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d4ae36ed868c008a22df7557fd800297657c43cc))
* rename 'Tags' to 'Labels' in ticket UI strings and Task type to Type ([414e6d7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/414e6d76a60c1877e549366906f7cda459cdc8c6)), closes [#7215](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7215)

## [1.163.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.162.0...v1.163.0) (2026-06-16)


### Features

* Add call joining preferences feature ([be8648c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be8648c0ee5617cad7979c7077490f2206d4f04f)), closes [#7615](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7615)
* ask ai file scope ([8982608](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/898260867c4cc6935a817c441fdbd2fd5ded8c50)), closes [#7502](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7502)
* fix for kanban ui not being reactive on change ([f5b42d9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f5b42d97982459ec07dc5ddc791a7f8b88a07f1e))
* Release Manager v2 ([1be7ec7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1be7ec7fa7c58c52bfea5c4b6eb1bac3f61980b5)), closes [#6046](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6046)


### Bug Fixes

* bot markdown links not following open-links-externally setting ([64ee2b1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/64ee2b11026807e952ac68bb0735e76c83d9474e)), closes [#7583](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7583)
* cherry-pick PR 7541 to main ([f23caab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f23caab651e55f3b10cff860bd063c745d8a081f)), closes [#7619](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7619)
* fix for support notifcations ([1a622d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a622d022b7bedde6444f3a4a54527fe74ff754f))
* fixes ticket creation modal title and desc field ux ([cb21feb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb21feb662598ea7010ee8b76cda39641af43092))
* making thread unread count and thread mark as read activities as same ([0272e56](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0272e560a1292e4244223e1942d16ccd7b1e1165)), closes [#7533](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7533)
* Move Dynamic dashboard from zero to non zero ([ed9fb1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ed9fb1b8d17843c6a6128e1d48fafa96fe3596db)), closes [#7491](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7491)
* removing the useEffect refreshing modal on every users change ([a8c1a86](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a8c1a86bc29aaab3c78e37239148f8272a4235dc)), closes [#7614](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7614)
* ticket type fix ([48fb910](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48fb910c71a17313a23d877cb49b9fa133d7385d)), closes [#7624](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7624)

## [1.162.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.161.0...v1.162.0) (2026-06-16)


### Features

* add workspaceId as a separate field in SAM meet-meta payload ([0910b9d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0910b9dd0abfda5aa07df1ecdd8399ffc18c8619)), closes [#7572](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7572)
* added debugger to ask ai ([026b6fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/026b6fddeb14ff31bee56697f7f3f9d609951328)), closes [#7302](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7302)
* backfill for defaults ([301c165](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/301c1657bc5575e62e1cb2daa8aab60168dcaec0)), closes [#7548](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7548)
* batching in validation worker ([eef5340](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eef53400aa1428650a75faf34a32a34547609719)), closes [#7535](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7535)
* fix for kanban ([5a4a107](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5a4a107a8455bab170faaf20cf5e41647b97a040))
* moved migrated ticket from one channel to another channel ([965ddc0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/965ddc0b7ff036a4210deb815987d61a512c361f)), closes [#7545](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7545)
* section unread counts, icons, and custom emoji ([3b2f46d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3b2f46d3c57a0bc04b770ef88529848bba5cb643)), closes [#7550](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7550)
* workspace-switcher in sidebar ([add3853](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/add385375216b8a6c1096621c836395ddd4d27c8)), closes [#7534](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7534)


### Bug Fixes

* [XYNE-DESK] Added field level input validation message ([527350b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/527350bc3d81b750eef6f1317967c0fcc100d401)), closes [#7135](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7135)
* [XYNE-DESK] added spaces support for fullname in desk ([0b7a217](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0b7a21794320297e1bb6fcc6ae3ebe7b36fedb30)), closes [#7140](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7140)
* Activity perf metrics impr ([e927a1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e927a1b7a8514d62fc872bd2da37fa38012d6627)), closes [#7542](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7542)
* added feature of canvas versioning ([8c4ce34](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c4ce34369dd908f679dfed48d4be7b2183f1cba)), closes [#7552](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7552)
* fix for @channel/[@here](https://ssh.bitbucket.juspay.net/here) edit in group DMs ([eeb270a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eeb270a8c2f24c71ea59758748a45151e3514deb))
* fix notification handler ([be5b9f7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be5b9f7bdf2df6e01f53af4db1e5afe8ae555b62))
* fix sub ticket depth to one level ([5a8ba03](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5a8ba0301f912cddef04f0e77a137c17b7665192))
* fixed selection for mark read unread ([f789335](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f789335a97d95313fc1bf7ad3a477d60f4ab0ff6))
* fixed user group notificaiton ([87660eb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/87660ebdcb28be93b3eaba67af94dd6f98656677))
* fixes for 403, 401 and mitigate cross-account session re-usage ([dbc87ce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dbc87ce66cc92914af6e9909309530d0814ac5a6))
* full page Cmd+K search fixes ([971483b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/971483b6a91eb7622437fd3c097c5e2b063882f6)), closes [#7472](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7472)
* reduce overscan for activity ([0f7fde1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f7fde1a15302b7ed75f247733e9d80d977c54f6)), closes [#7563](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7563)
* ticket tag insert fix ([921137d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/921137d4bfc65c66261af665a3b5c42dd5d57fc0)), closes [#7543](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7543)
* Voice input fix ([636e16c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/636e16c3620100d3027bcc0a9e7d106c6630b537)), closes [#7511](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7511)

## [1.161.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.160.0...v1.161.0) (2026-06-15)


### Features

* add activity sidebar badge ([0c39142](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c39142075171662aa74056e338b9fb8ba9dd81b)), closes [#7436](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7436)
* Add channel-based ACL to email model ([21e7e0d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/21e7e0dd270d5ffd92cdf50db0029022fd8a4ca2)), closes [#7394](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7394)
* added app shortcuts v1 ([af3e48b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af3e48bc56c65394eaaaa8bee270e84dfab21fdb)), closes [#7049](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7049)
* added pagination for kanbanboard ([6fe31c0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6fe31c0b67b7c1fbceb3f39ee3946a71213608d4)), closes [#7257](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7257)
* change sidebar to be better ([cb04128](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb04128b1fae115f7693d408c11f69f8d1db8994)), closes [#7451](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7451)
* citations in AI draft ([c5619c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c5619c23649a3e69fac29583e76c19e417c99142)), closes [#7332](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7332)
* common utility function for title validation ([c0c8f28](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0c8f280fa1c4ba6132310418e69dc656f5b5c92)), closes [#7439](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7439)
* Feature/priority filter chip ([6e7a88e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6e7a88ef4e4b89f043aadb5d8818991bcc0cfedd)), closes [#7494](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7494)
* Feature/search blue filter chip ([d58a142](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d58a142a41af5555a1cc4f44dac19a13f6d62cd3)), closes [#7365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7365)
* LRU eviction for query cache + lazy load from IndexedDB ([4ff1207](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4ff120703b8bdc70a6932725d7ee767314f60634)), closes [#7328](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7328)
* now we call the /webhook/:agentslug instead of /webhook/ ([7dd5537](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7dd5537e62904121f39dff70c26d15c286ddc429)), closes [#7261](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7261)
* preselect board when creating ticket ([cfd25d4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cfd25d4fadf501c425d0e375dacff6dc4fca7f27)), closes [#7366](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7366)
* remove sessionId from logging ([0e102ae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0e102ae3024ee1e4039ae7072c57ae0732552fb9)), closes [#7452](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7452)
* retry logic improved ([4e5fbd6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4e5fbd645d55174041482ae94a93f920d09955fc)), closes [#7406](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7406)
* revert file streaming in download ([e9c80a2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e9c80a2c00d864a39114753d088bec1ed677cc4e)), closes [#7404](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7404)
* ticket-is-based migration ([cb85176](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb85176fd1d21c1c0a0ffa609405181041b69d6b)), closes [#7397](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7397)
* zero container fix in automation test ([3063514](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/306351429d3fbc8f5764f5897e2396f1d0d6d812))


### Bug Fixes

* Activity re-render fix ([d9b090d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d9b090d5951330c8672a2641c3eb12ad77b77909)), closes [#7468](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7468)
* add UPDATE_FORM_FIELDS automation step for ticket form field population ([8290ae1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8290ae1ca8afcdbefcce40546be0c54d0248220f)), closes [#7319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7319)
* added admin check for support and ticket routes as well ([8f28e0d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8f28e0d09b63f10c8071991234ccf3cdccac0de3)), closes [#7407](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7407)
* adding workspaceId in conversation, ticket, and activity table ([2086f44](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2086f44b4ff6b81f0fe4212fafaed46ed182ef9b)), closes [#7483](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7483)
* Canvas Mobile Navigation Fix ([38bb381](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/38bb381f7abf683f5cba550c792422e307143ae9)), closes [#7435](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7435)
* fix ([b45c0ec](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b45c0ec084c45ae2f93fc5cbad458cba93c24327)), closes [#7461](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7461)
* fixed bar chat vie, made table view scrollable and added group by day for date type columns ([2be1c1f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2be1c1f54458d719b2bd56618bb3cc1850979d40))
* fixes inconsistent shift-enter behaviour on bullet list ([5af0ac7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5af0ac7df08972c2ab8feb01a4bb6f9bee6e690a))
* frontend perf-metrics attribution + heap snapshot + extended buckets ([e2d95c7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2d95c733b2118cea3f9d5ce924b10a1737c2c2f)), closes [#7463](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7463)
* multi dl desk fix ([f12a6c8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f12a6c8f4b25853b2ec9fd70babdc4f66937c15c)), closes [#7420](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7420)
* Password login fixes ([a225628](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a225628918d36084b8e65fec83ac3e80e3cd296e)), closes [#7427](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7427)
* per-source vespa permission guard (fixes type= filtered search 500s) ([450549f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/450549f512f3f14d3605e58bd2ddf5967cb0208b))
* recurring call time update ([9511f54](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9511f5462f2aa5efb4cd82083421611b9f5368b6)), closes [#7444](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7444)
* reduce zero ttl to 2 mins ([450bbd7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/450bbd7285705dbcf659c8dcc2c228afc049d2c1)), closes [#7457](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7457)
* Restrict workspace creation to admins and writers ([074ec77](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/074ec772326f89e4c975452193f18d44ea5256cc)), closes [#7335](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7335)
* revert Inspector module ([9d477f4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9d477f49612a21ae3f13d02ed1638af3b4631dde)), closes [#7500](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7500)
* yql injection fix ([7b3097a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7b3097ad76f4b9bc0c8c6a905b762576fccebbd8)), closes [#7432](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7432)

## [1.160.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.159.1...v1.160.0) (2026-06-11)


### Features

* add automation CRUD REST endpoints ([04a9e64](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/04a9e6428cbac77970f3d2acbb8bd6ba18a4ec86)), closes [#7358](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7358)
* add dm channel project backfill api ([e2e0354](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2e03547eb18c5d6eb079dc1adb3505576d702b1)), closes [#6860](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6860)
* add focusThread functionality to activity components and update navigation behavior ([2acbc49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2acbc49ecb5c266f7e55e10a3901b34822368fa3)), closes [#7278](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7278)
* add project_tags and ticket_tag_mappings data model ([69ae9ae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/69ae9ae054f0d34e958d800a77bafb429e2ae8c1)), closes [#6899](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6899)
* Add send to conversations option for create ticket ([4fd5186](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4fd5186d8d1480326a8d42acad8b399e23b89f8e)), closes [#7071](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7071)
* added abort button code ([d40e28b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d40e28b414424497384384302f15ade7fb478a7d)), closes [#7204](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7204)
* Added Email Password based login for non-OAuth domains ([14c6d5d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/14c6d5d317a8e423c6390704e58b56483df15c0f)), closes [#7194](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7194)
* added epic based filtering ([14695a8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/14695a8daba2bc05f7ee56681be56c12e6bc1580)), closes [#7295](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7295)
* added mark as read button option per activity ([492555a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/492555a5acbc8e0d7504da5ec4bb41d8a9f0c247)), closes [#7284](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7284)
* Adding sections to channel ([fa6127a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fa6127a55e19a4b2533c8a9fcb79a8ae92540729)), closes [#7086](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7086)
* global and channel notification preferences ([d2274d8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d2274d86bc9a16c22602875d711f24d5e389a8be)), closes [#6947](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6947)
* preprod toggle electron ([99b307a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/99b307a15982b2caebccf6f087897046474f8eae)), closes [#6661](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6661)
* query acl fix ([c05df58](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c05df58323f5b7d0acded5e2e5ce19921052a010)), closes [#7289](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7289)
* ranking vespa ([7b1071a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7b1071a08449da03c9f2a8f08ea0af6cee7974a4)), closes [#7317](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7317)
* redesign email composer ([9e44e00](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9e44e00ad50a5e0a085b8d75e8e2eaf74c73e71a)), closes [#7267](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7267)
* sizebar minimalize ([f12daf4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f12daf4a713fdbb24ff23327fc74e284ba7864c0)), closes [#7110](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7110)
* support rail ([89bc760](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/89bc76008de20f1702a6614a2cf46e052ac719e8)), closes [#7343](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7343)


### Bug Fixes

* added dm support and fixed render issues ([232c3d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/232c3d6a0636a422f9f87e89aa093b0b91b2d3c9))
* added logs for call edge cases ([0413410](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/04134103050d49d396df984479c9cd3ccd3d9e85)), closes [#7160](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7160)
* Attachment Streaming Bucket fix ([e0e1823](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e0e1823bf9600e62edfc535a830dceaa8c89c3af)), closes [#7321](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7321)
* automation notification fixes ([68b262d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/68b262d07e73c559bb5514aa50b056c4750442e3)), closes [#7354](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7354)
* automation notification fixes ([de85d02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/de85d023769c15fd5dcd2320ae6dabad6afc5bec)), closes [#7309](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7309)
* Change DM input placeholder text ([385db39](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/385db3956f3dff10de7101bc2036f7077c5bcbfe)), closes [#7161](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7161)
* closedDM issue fix ([dc9c2ee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc9c2eed287ff6b802abc4c86ccb1cb0220119f8)), closes [#7305](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7305)
* dashboard perf detached dom and resize observers ([fb3eb2b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fb3eb2ba94ac536c15c858c9921f27ce306c9e80)), closes [#7217](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7217)
* error handling and minor ui fixes ([e95834a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e95834a53789d68d634df05181cf8109d4f00c96)), closes [#7121](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7121)
* error handling and minor ui fixes ([21a1a69](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/21a1a69dd6e9e873fb4cdb5c99d5025f84107bb3))
* error handling and minor ui fixes ([d6ff803](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d6ff8035d2f3957cd9bf1e76284e4e404bfe6fbe))
* fix board suggestion cancel ([9cb87e8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9cb87e8d0334cdb2792225019ab9969a92e966de))
* fix test failures from sidebar More-overflow change ([cf801e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cf801e980b9758888448106ba57bee3ff79b8d63))
* handle external link behavior for table and PDF links ([6296a9f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6296a9f4d9606a94cd7a6f3004f0610bea919dc2)), closes [#7273](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7273)
* hide jump to top button in bottom when not scrolling ([87cc1f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/87cc1f50de4165a6b86ade6b8d88107786e2015e)), closes [#7269](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7269)
* logging issue fix for users having all the cookies ([32d4c4d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/32d4c4dd2c3267d341e03eaf9ec1fd4b86a65a8c))
* md broken in digital twin body and dm list notification issue fix ([ebf4a44](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebf4a446ab9ce8052ed9cd3deda91c073e35207a)), closes [#7281](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7281)
* query channel project separately ([7b492b7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7b492b7f17b7fea026c871d78799b18b932559f0)), closes [#7218](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7218)
* upgrade @rocicorp/zero from 0.26.1 to 1.6.1 ([a798ff5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a798ff50a59cad1f88876f5f002baa6c170da581)), closes [#7183](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7183)
* xyne desk settings ui revamp ([c330419](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c330419808fb4e90d3b554ed4e43e5ae1141e659)), closes [#6811](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6811)

## [1.159.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.159.0...v1.159.1) (2026-06-09)


### Bug Fixes

* show recurring calls per day and fit calendar to viewport ([f6ad4e8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f6ad4e8d3cd06fd8dcd96b9c762a07f789f01c14)), closes [#7202](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7202)

## [1.159.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.158.0...v1.159.0) (2026-06-08)


### Features

* Add victoria Metrics for suggested vs created tickets ([7d3c323](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7d3c3239f296d1ae41f3a582c29699008e3bc828)), closes [#7164](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7164)
* added for slack adapter api as well ([aa92557](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aa9255786e8eb3b84e34ff14876565a9e3ad7a38)), closes [#7203](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7203)
* Ticket Creation webhook support ([d35166d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d35166df458d448b446235b6421f7c18183c0030)), closes [#7199](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7199)
* Use Draft Agent as default agent and AI Composer UI Revamp ([5b67167](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b6716776e6f82a0e71335ce552075e69fa5a24b)), closes [#7115](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7115)


### Bug Fixes

* [XYNE-DESK] fix email type support ticket boardID issue ([6058ae2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6058ae2684605dd0c18e258277abf66d7c8a31f6))
* added ticket delay fix ([d163354](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d163354e0d1d6c39ed633ade1db147236d25f57a)), closes [#7208](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7208)
* allow re-adding users to channels after removal or leave ([9d6c314](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9d6c3144ce1e2fab5d71f81b380b491cf7f2eb38)), closes [#7163](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7163)
* automation steps ([2bca196](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2bca1964c9a1b91c0ffff89a0b9c0089b94ee0e0)), closes [#7251](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7251)
* automations message ([a5d482b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5d482b6492cc4d24db5a064dbc202022f068931)), closes [#7237](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7237)
* calender sync fix for electron ([09ce1fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/09ce1fec5f56af0d592dadbedfdf0b7f0acf6f2f))
* login fix ([f96198d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f96198d7df9006ec2caf96a430510555f1bb8149)), closes [#7205](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7205)
* Prevent navigation for attachment onclick in linkpreview messages ([75acc39](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75acc3935ff2ac606adae3d3602dc68397ca1ead)), closes [#7041](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7041)
* remove resource protected rule for support tab ([73f9574](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/73f957492fa13b98a5ff570ea09a0621c7d72657)), closes [#7222](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7222)
* schedule-end-job-bug ([054bc2b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/054bc2bd10edfe0ab298c308a47237d35e6d36b7)), closes [#7211](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7211)
* search screen ([b49d3b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b49d3b0ccb439750b865081954c7d2c57f7e06c6)), closes [#7083](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7083)
* slack fix main ([ae59a1f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ae59a1f05b98454ed6724a00c7fcaf34ffa0610b))

## [1.158.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.157.0...v1.158.0) (2026-06-08)


### Features

* unified config map for juspay and nammayatry ([d7ac6f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d7ac6f51aad7c57f0e92a6e7fd78a028ea5f68a8)), closes [#7014](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7014)


### Bug Fixes

* scope Cmd+F to search-mode GlobalCommandMenu only ([db998fa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db998fa3a662b09fe3e569d3108bac33e19fda72)), closes [#6295](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6295)

## [1.157.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.156.0...v1.157.0) (2026-06-07)


### Features

* [XYNE-DESK] xyne desk fixes ([cd3318a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cd3318a55841a6459703e9a73afd0205a02bfb77)), closes [#7177](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7177)
* add switch statement support in automations ([711be66](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/711be6605482026ca2dba22d960b590ec91dbfc8)), closes [#7181](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7181)

## [1.156.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.155.1...v1.156.0) (2026-06-07)


### Features

* [XYNE-DESK] xyne desk draft fixes ([d9f2ab7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d9f2ab764bd53cbc230e3925550d6b15113a05f8)), closes [#7162](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7162)

## [1.155.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.155.0...v1.155.1) (2026-06-06)


### Bug Fixes

* removes metrices from topbar and fixes overflow ([e091920](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e091920eee6a3b6232dd2ff813168e515eec5e60))

## [1.155.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.154.0...v1.155.0) (2026-06-05)


### Features

* knowledge base with Ask AI. ([a5fa1e0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5fa1e03213da146f6977af8ffc43dff33b9cc42)), closes [#6287](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6287) [#5751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5751)


### Bug Fixes

* automations and slack disconnection for desk ([d4f2973](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d4f2973153569224859941a6f2601599c7bf2042)), closes [#7165](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7165)
* remove mark activity unread from mobile ([96a977e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96a977e5d2399d197aa6c2a94fa58ed2babf26b0)), closes [#7145](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7145)

## [1.154.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.153.0...v1.154.0) (2026-06-05)


### Features

* add frontend performance monitoring metrics ([b487031](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b487031c4c0dfdee3859e20557dc50aad0e7a1a1)), closes [#7101](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7101)
* Add hierarchy-aware search to canvas tree view ([c05fab9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c05fab9eb8ad0b9cf8dd210cf4190476fd50c057)), closes [#7047](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7047)
* call new design change ([cddaea3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cddaea325504a82df856c2d9939b7087c2eac07b)), closes [#7016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7016)
* Feature/XyneApps Filters InstalledBy ([9998040](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/999804017657eb29c2029b87bf5b17ec39377b5b)), closes [#6957](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6957)
* increased date for sbx ([71c2462](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/71c2462e8f78e5dc98bf21d06d8b00e387d2cbc6)), closes [#7141](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7141)
* Multi Agent Support in Ask AI Sidebar ([0b38afd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0b38afd2a8afbdeb0c5197a108f6f1a31ebec8c0)), closes [#6919](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6919)
* network handling ([157a212](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/157a212fd9a6c4b7267a6eebeb1dc0a0eeb6e522)), closes [#7111](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7111)
* remove project and board delete buttons ([3fed550](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3fed5507d55bed23aae07fa37356214782c56338)), closes [#7114](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7114)
* slack to desk channel list fix ([b6e2ab8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b6e2ab81deaed3f9babea68eece4733dd9b4fb4d)), closes [#7069](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7069)
* streaming in upload download ([a487bd5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a487bd5177733bb913bae3978f8c44aad9ce0561)), closes [#6835](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6835)


### Bug Fixes

* Add search bar to create channel dialog and entity selector component change ([b898cee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b898cee7d6ffcaf5f3d8cd5bfd7ccb555c54bb14)), closes [#7034](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7034)
* added check for the usergroup and channelgroup participant ([0d02ba2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0d02ba2f621509f05e0fc44b904b9543029945d2)), closes [#7136](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7136)
* Added Hyperlink Tooltip in Desk ([cd0cd4b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cd0cd4bf4fa89344561bb17a610d2907c2bf880d)), closes [#7076](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7076)
* Agent Selector UI fix ([75d9a1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75d9a1b3de2f87d200211b4c5105d7b808c68863)), closes [#7125](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7125)
* automations external trigger fix ([a1b3e34](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a1b3e34c33b638efd3eb40150e494fc6ea71560d)), closes [#7087](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7087)
* blockit2flowJSON fix2 ([1eaeae6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1eaeae662b0c0920003ec74edb2fe5846a578810)), closes [#7029](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7029)
* bot messages in search ([93040c0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/93040c0f3125161d28f30a6866c95217de876c92)), closes [#7089](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7089)
* cap brightness of custom emojis across all UI instances ([786ef5c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/786ef5c943db487d9277a05ae85a7fe7c337b950)), closes [#6007](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6007)
* empty DMs hide ([0b01398](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0b01398b2328f59693d18a915058bef09bfe0a68)), closes [#6750](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6750)
* Fix blockquote text opacity visibility ([4e92fae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4e92faec8d53fc460659e53d934c05146197e277))
* fix messages scroll ([072b390](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/072b390e43b9de893e5860e9b8a64c1510a92c82))
* fixes inconsistent shift-enter behaviour on bullet list ([2774c7b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2774c7b0eba64603dd48910cd22b74f5714993f0))
* outages alert implementation ([7dac048](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7dac04862c4112cee0827b4ceea5509cb809d08b)), closes [#7046](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7046)
* receiver setting changes ([571293d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/571293dc97c86916d1fde534771eb11bbc43971a)), closes [#6958](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6958)
* restore handleUnreadCount non-DM branch for backward compatibility ([825cc28](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/825cc28ae1bfc75df0d7e7642f82b05b12ed5c15)), closes [#7090](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7090)
* schedule call issues ([9af7201](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9af7201631c1cc7d43f97d8559416ea56bf3ec6f)), closes [#7148](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7148)
* star canvas for users ([f4c2e7e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f4c2e7ee630d705afb40e5142be05c85ee21b919)), closes [#6904](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6904)

## [1.153.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.152.0...v1.153.0) (2026-06-03)


### Features

* automations resource opening ([1b19abd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b19abd8dafcc21a3e77f123f2bf619446b22818)), closes [#7063](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7063)

## [1.152.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.151.0...v1.152.0) (2026-06-03)


### Features

* add claw agent as the default one to generate autodraft ([476e11f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/476e11f7d034119561915fade98189e8f7d8428a)), closes [#6994](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6994)
* delete-notification-on-app-edit-and-delete ([a303301](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a303301c0596c7c15dc82ffa9de225df23c18b5a)), closes [#7015](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7015)
* implement dynamic dashboard ([1580c91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1580c91aacf57841ab0cf0a50779a58b763dd232)), closes [#6393](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6393) [#32](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/32)
* move db:push + sequence migration into backend-migrate init container so backend healthcheck window stays free of schema-apply work ([79a4fc4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/79a4fc445e480ef05edb0c173b8a24e9e757432d)), closes [#6736](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6736)
* Persist canvas filter, view mode, and last opened canvas ([7806e6c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7806e6c1b99aa492b3766e69887eb81e3ceb0f17)), closes [#6966](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6966)
* slack to desk ([6b950b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6b950b9abb8e5fe013781c4221a289d4a84d6f77)), closes [#7005](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7005)
* xyne desk fixes ([46227d7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/46227d76dc56922d4d0f8bed2474298868b9e395)), closes [#6964](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6964)


### Bug Fixes

* deleteRecording fix to remove deleted recordings from MERGE_RECORDINGS_PAGE action ([0c2bad0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c2bad0ae9b62d3b8f0199286bfcfa2273bf4199))
* Feature/email type ticket support ([48ef0fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48ef0fdf8dc225879994ed2858a76061eaf2f438)), closes [#7020](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7020)
* fix height estimate for ticket ui ([f7d47d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f7d47d6ceb8c77efb8c32cbe048d36c535b4dbd4))
* fixing first message deletion in live subscribed window ([567c236](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/567c236ca6eeef2d7f6de4e86b19e2aa10a6ccba))
* Hide Calendar Calls ([a58ea4d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a58ea4d264df1ab538ea82ad0b99d4ee682d05d1)), closes [#7021](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7021)
* hide placeholder on whitespace input ([9a16a1d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a16a1d3a10dfae5f8863baacb2684842b6a47ac)), closes [#7035](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7035)
* removing dependency-cruiser ([ee0f1d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ee0f1d0979eaaba65c4de8925bdc5896e478078c)), closes [#7042](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7042)
* use $executeRaw in backfill to avoid Prisma [@updated](https://ssh.bitbucket.juspay.net/updated)At bump ([4fd4231](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4fd423138fb97d9850b3005964688e8905dc95cb)), closes [#7030](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7030)

## [1.151.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.150.0...v1.151.0) (2026-06-03)


### Features

* add logs for Grafana dashboard ([7d0302f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7d0302f22ef6da27c97fbe79e57894d5be04cbfb)), closes [#6903](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6903)
* added network quality indication ([370f557](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/370f557c1566db2d93326c2c46ee866e34f0ae0d)), closes [#6976](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6976)
* external trigger in automations validation ([31a74a3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/31a74a313cd87c4420c75d0058c6acc34334fa27)), closes [#7011](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/7011)
* fixed notification title for dm ([7af3984](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7af398492b78efd82c69f153866f37857c87c6e8))
* team intelligence org and team and individual level summary and ticket generation using LLM client and existing recap module with routing changes from teamName to teamId ([d730ab4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d730ab4095d7143f43949a76b7b7d669d0e6b7d1)), closes [#6756](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6756)

## [1.150.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.149.0...v1.150.0) (2026-06-02)


### Features

* added apps permission ([09cf553](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/09cf553f27ca0ba1dc4451b84863dd6bf5a96436)), closes [#6651](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6651)
* merge feature-deploy-xyne-claw to main ([32c1667](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/32c1667a2baec0255df7829824ccef59a3f8f407)), closes [#6822](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6822)
* mtls workspace integration ([c030fc8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c030fc8d499906d406cc224e9423a64d57693a0c)), closes [#6984](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6984)
* query improvements ([931c4ab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/931c4abc37beeb3decfa04bdec619f9c084de9cd)), closes [#6722](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6722)


### Bug Fixes

* add messageAttachment to ALLOWED_MODELS in pythonQuery validator ([8de958d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8de958d7d1c612482b401cb53fefbea0d8499228)), closes [#6856](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6856)
* fixed deletion of a soft deleted conversation ([1351c87](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1351c87b5d2ee0f032d98e63c038692c86fb9de7))
* fixes bug, groupd_dm suggestions not coming in the forward message modal ([971a7c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/971a7c306488a2333c614877e775d5f1998ecbce))
* optimize rendering and reduce main thread blocking ([9612347](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9612347af84bb54f1f123c7b55055a6da2138081)), closes [#6949](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6949)
* revert ticket attachments relation from conversation list queries ([2812195](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/28121959127c728a4dd2025dd2f17f6ff6fe8360)), closes [#6980](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6980) [#6475](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6475)
* sidebar alignment ([5eada1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5eada1b7c3456f1772b2b70ac5b030c411a7633c)), closes [#6900](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6900)

## [1.149.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.148.0...v1.149.0) (2026-06-02)


### Features

* add isThreadActivity to activities, derive unread counts from activities ([a0a9db4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a0a9db4ab70f0ae6a4a4f98cf00e3e1074c333a4)), closes [#6794](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6794)
* add scroll-to-top button in thread panel ([b67f0f0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b67f0f035e73e1d40e8820d7b82320607d8143e1)), closes [#6859](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6859)
* add workflow ([dc32b49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc32b49b5f99b7fb177f17d8a0bcf8622ed44f20)), closes [#6386](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6386)
* Added ability to change ticket type ([eca4df2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eca4df22830231e54bff480eab3d6cc2e5da1ecd)), closes [#5451](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5451)
* added mark activity as unread feature for different kind of activities ([e6a47e5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e6a47e52c19695cc1a7947b7c173db7c75d68160)), closes [#6703](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6703)
* added notification service for canvas sharing ([8ae2491](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ae24918c2c0cbfbdd322eb0592c6a9345c4febc)), closes [#5702](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5702)
* additional key for scheduled cron ([e5387da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e5387da27d8243b49b542567e003002b275d515a)), closes [#6887](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6887)
* automating slack channel migrations ([a40bcab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a40bcabb25dcef196f705c4f42cd97aa41d99f71)), closes [#6596](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6596)
* automations in xyne spaces ([e84bc67](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e84bc675c86cdd82dc3b1cc34032437700938224)), closes [#6245](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6245) [#6612](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6612) [#6560](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6560) [#6507](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6507) [#6409](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6409) [#6382](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6382) [#6291](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6291) [#6102](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6102)
* call history pagination fix ([c54ddef](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c54ddef2778ab302917cfe67cbcfbc29b0e5f96a)), closes [#6931](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6931)
* create ticket API Fix ([bc21eaa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc21eaa85b8f949d16d1f2f65d4f9117d586733a)), closes [#6863](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6863)
* DL type desk and routing ([bd45a47](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bd45a4767f7a9d01d0078d223143d8a846e061c2)), closes [#6676](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6676)
* drop redundant routes from unauthenticated-redirect spec ([75aef4f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75aef4f070457404019953b5dc4708c5d288d4a5)), closes [#6901](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6901)
* external call ([8abad67](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8abad67aa9a3b1f8c3217c8158a9ba677e3d14f8)), closes [#6751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6751)
* fix for repeated silent notificatoin on thread scroll ([6d40d1d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d40d1dcb4852c63668b14ce3f4c70908aa66eed))
* Hide calls from calendar ([cdfd2c7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdfd2c7de86dd1b08c9bc94e6b40e63d9047e3a2)), closes [#6649](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6649)
* login at calender sync ([b2576c1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2576c1ed15e4297877f1818190f290aa96e1704)), closes [#6770](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6770)
* notification conversation cache ([65b2f39](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/65b2f393b997fb4ea2c2698b7e6f5f048fc7eea7)), closes [#6695](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6695)
* perf(migration): defer channel participant insertion to after message ingestion ([5a89e88](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5a89e88654099f9249c8f3cbc305c2b7ffc68a9b)), closes [#6922](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6922)
* route Jenkins to gauge by default, cucumber behind USE_CUCUMBER; drop CI parallel workers to 1 ([122561f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/122561f5684c6c1e4b25540992c8bde08fed0871)), closes [#6735](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6735)
* workspace count fix ([2154bd7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2154bd730708f085b209202ba2e6198097c49c60)), closes [#6912](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6912)
* xyne desk channel fix ([edcd188](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/edcd1884f4f296049da45fdfb2116d91509b96e0)), closes [#6795](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6795)
* xyne desk kanban board fix and add some logs from draft ([1ecc2c8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ecc2c83ce8c89287202a328af59059871369503))


### Bug Fixes

* activity thread backfill - handle null conversation, add dryRun, add /api route ([688177f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/688177f400a599add405be8280e0551634e12a3f)), closes [#6929](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6929)
* add AI classification to inbound email ingestion ([c0dbbde](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0dbbde83bcbea05bdcbc61c00474a2962fe8471)), closes [#6759](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6759)
* added changelog generator back ([d2a5a84](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d2a5a841570385b270ed09c6d2b9e9c7a6167fd9)), closes [#6349](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6349)
* added confirmation and support for attachment in xyne-desk ai summary ([1ab8d40](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ab8d4018c654149997c2c68b4231e2e1d97f7a8)), closes [#6351](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6351)
* added lotus logger events in shared ([3fa4d12](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3fa4d120af58aebc80955d26969cf7bcde8db749)), closes [#6936](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6936)
* AI Composer Panel fixes ([248a8db](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/248a8db088be2ad45e42f8c46cc9bb3ebe704b80)), closes [#6908](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6908)
* ask ai claw citation/canvas fixes ([cf84e44](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cf84e44f795d31b1e7bbfc3f69de1079987c6678)), closes [#6802](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6802)
* block attachments addition in Edit message mode ([f2545db](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f2545dbb3406f19851c6733318cbb84a2bbfeda3)), closes [#6920](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6920)
* bot mention via bot ([bdf4194](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bdf4194331fbfe5e8995228b0d14af0b49d703cc)), closes [#6921](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6921)
* call new design change ([7e8e7a8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e8e7a8c7ff7e50fed7d5a9b1bec19e8b3ee350d)), closes [#6079](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6079)
* close hover card on scroll ([e0be5c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e0be5c3b08b32fa2a4bdaa87b90a82b048a719e5))
* cmd + click / ctrl + click on links attached to a channel should open the link on my default browser ([ef41806](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ef4180608135e88db4c2bf4b90a5cc412894e3a3)), closes [#6670](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6670)
* dedupe mail composer to cc bcc ([a33072f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a33072fbf074dbae4d10e633c41fee0670560cb5)), closes [#6777](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6777)
* disable [@channel](https://ssh.bitbucket.juspay.net/channel) and [@here](https://ssh.bitbucket.juspay.net/here) mentions in thread replies ([95aaa28](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95aaa28010d8a907b12b8e3bf15e3cec6647b31c)), closes [#6557](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6557)
* DL type desk ES fix ([a746f0c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a746f0cc81e0dd13e32fad319d9085b5a8d832da)), closes [#6943](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6943)
* dm unread fix ([3434c9d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3434c9de200a43817180eafb937bf1633b0a7ca1)), closes [#6004](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6004)
* Enable panning on zoomed images, videos and pdfs in webview mobile ([0bad84e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0bad84e4eb1f5e14448e18a115b5b3cb07199221)), closes [#6746](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6746)
* filter orphaned messages in backfill query to prevent Prisma null relation error ([b2a3ffb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2a3ffbeb07341a2ce778b86165e82d7f8d1e7ee)), closes [#6938](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6938)
* fix autofocus on reply, show initiatedby, and reduce gap in signature ([30da6ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/30da6ff89931b2c41ac12f4e2727c37084882f94))
* Fix email composer resize and mail overflow ([d73757a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d73757a3ef54131735d3bc87e27d6d90ee0d9ea3))
* fix for automation validation ([b127252](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b127252b11f61abeca0a7ba8efa9364e5ab6293a))
* fix for automation validation for agent step ([ee44d51](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ee44d513c7203874d452fa99a9ed24c1989a71c8))
* Fix Minor UI Bugs Desk ([c43407c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c43407ce349ecb48e7b40ab4d3e178332e8c7893))
* Fix project board filter showing all boards ([f08e422](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f08e422434cfc66bfa868806061f56f1ad666a68))
* Fix unfurl preview showing ticket card instead of message preview ([50ebf8a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/50ebf8ae03bb6642d41c687afebfa1464afd5f15))
* Fix xyne doc response copy truncation ([4694de3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4694de359dc9931b2126db31271479e6eaae8302))
* get single thread message of a conversation api ([a7fb1ad](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a7fb1ad1d6c4d538d2bb5349e0ca44bf23d01592)), closes [#6840](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6840)
* Implement complete sync in jira migration and change to bot user resolver ([c58f08f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c58f08f8a090fc7976034c5a917c3497595c5bc3)), closes [#6866](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6866)
* IntegrityWorkflowFix ([8716b64](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8716b6455696185cfa9deff98f23da0d5fe950ec)), closes [#6767](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6767)
* latest message delete in channels ([07a3e02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/07a3e02dd1515ddbf261102a6353dfdf7014a1fd)), closes [#6923](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6923)
* merged queue for claw and automation ([6be902f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6be902f6bf07e6433403d1a6c928207de6d752c1)), closes [#6757](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6757)
* restored bottom scroll when a new message is sent ([dddba7c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dddba7c3bd8e554fda1903a9629803a4d3870b7f)), closes [#6814](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6814)
* revamp of canvas share ([4819099](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48190991b89971a44445743b2854233510239039)), closes [#6075](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6075)
* Revert Add lastReplyAt to conversation_participants inserts for first replies ([a43407b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a43407bb7feeaa6d08568c9d00b29de0bbda4480)), closes [#6824](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6824)
* revert call design change (PR [#6079](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6079)) ([06ef120](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/06ef1202a996b71f328fbb89847e82467a040bf2)), closes [#6942](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6942) [#6901](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6901) [#6649](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6649) [#6931](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6931)
* revert navigation shortcut ([0fb0247](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0fb02473b5b2b241fa685f167a75d68d4a592b79)), closes [#6953](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6953)
* revert pr for passing project id ([a0d7c6a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a0d7c6a7df6e652e7f3243ab79ae7872ca852bd4)), closes [#6892](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6892)
* Save the state of overdue tickets filter toggle and the substatus filters ([cc889fc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc889fc1e2c00d9e467b4c58a0150254be68cc28)), closes [#6748](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6748)
* self-DM draft shows Unknown User in sent-to ([ffe188a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ffe188a332309f6049b4d3aca6f752904e2f7887)), closes [#6823](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6823)
* Skip AI title generation for HEADLESS recording calls ([c2d5d37](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c2d5d37630915f7d3bdcf48d20f20cad1fa85777)), closes [#6632](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6632)
* UI fix of Ticket Activity ([ed13596](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ed135963673a798eaacc7e77d649695840d1197b))
* update authProvider on auth callback ([8ee4c05](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ee4c054bc31dc54ccb6ee67b8bdddf571d47a86)), closes [#6798](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6798)

## [1.148.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.147.0...v1.148.0) (2026-05-25)


### Features

* added mark as unread for threads ([ac010a4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ac010a4eca512d21975111f509551dc4e6251a8a)), closes [#6255](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6255)
* notification count update on workspace switch button, /no-access refresh page fix ([531d646](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/531d646f499426c637b60e7f880eb3afb0bbe62f)), closes [#6633](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6633)
* Notification improvements ([76fbb23](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76fbb23f7bf65eb4cce0f701ec583afbe39d6613)), closes [#6561](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6561)
* remove redundant ticket queries ([4bd58cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4bd58cc4ea5006f24aa414d20df52ea6ca75db3f)), closes [#6638](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6638)
* xyne desk perf ([d63b71d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d63b71d471f5302f0f69218e06f379f3ba021e9f)), closes [#6681](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6681)


### Bug Fixes

* add filetype field to Slack-compatible file responses and tighten mrkdwn inline formatting regex ([b2c4261](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2c426197b5e7de6bdbddca3d38fbdacf168db81)), closes [#6585](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6585)
* Add short circuit to RSVP click ([2cf5f42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2cf5f4253861d8080d8109617380a5d47013ae04)), closes [#6712](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6712)
* add userVisibleChannelsV3 excluding EMAIL channels from channelStats ([f206d28](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f206d28cce47a70b7f53e8e15816f24c7b48088e)), closes [#6690](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6690)
* dark mode fix ([aa4794f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aa4794ffd1f917524b7296f203f30c5053994990)), closes [#6583](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6583)
* desk auto sync fixes ([50efaa5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/50efaa5303bd79e9e3d2aa8394e4a8ded661393a)), closes [#6693](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6693)
* fixed the transformWrapper w/ explicit Height ([6af3cde](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6af3cdee6f838162cc58d7e4a693dad8dfff58b7))
* flowJSON fix for notification and render ([5d51f09](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d51f091b2f10c5d386d244aacee57704acf17c4))
* migration from public to non_zero ([5efb90a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5efb90a961e0e5738e07ffa5e522267df5d15e84)), closes [#6700](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6700)
* open ticket description links in BrowserPanel side panel ([1b9b2ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b9b2ed0f862935f2166faaf7e65718eaad5dc77)), closes [#6697](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6697)
* Out of Order mutation hotfix ([8cdd4ba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8cdd4baacea48ab5baf9c9c99cc3e9f4e64cd971)), closes [#6635](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6635)
* passed project id and project name for claw ([10d4aec](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/10d4aec7d73b6ffbce7b46d7c32d328ca0531bdb)), closes [#6592](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6592)
* sync-participant user creation (Workspace independent) ([612107f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/612107f106abb8d9af75e69775df9d61175cdc3a)), closes [#6646](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6646)

## [1.147.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.146.1...v1.147.0) (2026-05-25)


### Features

* Add support for multiple DEFAULT_ADMIN_USERS ([1044b9e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1044b9e20ae18bc8a88b243648d10a368f34dee0)), closes [#6604](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6604)
* add vespaQueue initialization in worker ([505dfcd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/505dfcdf5edb2855995694b470575042f2af2fc8)), closes [#6578](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6578)
* added cutoff mode support in Activity to ChatList navigation ([b3e9a3a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b3e9a3a4a8a9c815bc4d60563828f6321d406351)), closes [#6327](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6327)
* added share trigger for mentions in canvas ([decffea](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/decffea39852a9495103aba3c2ef556a31a9077e)), closes [#5722](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5722)
* Build Team Intelligence Pipeline with LLM-Backed Summaries and Deterministic Fallbacks ([300a20e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/300a20e91f2673f3aef2dd490f150e35756fcb10)), closes [#6554](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6554)
* contrast for dark mode and unread toggle behaviour added ([3a07e42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3a07e42b9779d4523943146fa138c81a4c4690da)), closes [#6593](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6593)
* dedup check in code rather than fully rely on unique index in db ([256f40f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/256f40f7d9468f577672626cb7fbe867089fc49e)), closes [#6495](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6495)
* desk scoped search ([1e4cbce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1e4cbce347eb2b962bff45ba64054d777aae52fd)), closes [#6667](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6667)
* fallback hydrated query main ([7df3f56](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7df3f56bf1fb46827e467c15a4bb0705cb6dd36a)), closes [#6573](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6573)
* Store channel update in call and recurringCallSeries Table ([2bce986](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2bce986267104083be9c69c4784490dc68aeb5d0)), closes [#6490](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6490)
* Update ticket API xyneClaww ([ae4fed2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ae4fed2440e1160e787434466b64b6a518c8c8ef)), closes [#6542](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6542)
* user groups and group dms can be added as call participants ([9139175](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/91391756fae18d3b79ffd31c05165f06b83a2441)), closes [#6459](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6459)
* xyne desk perf ([36e0076](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/36e007660799568fdde0b878c8fba9760629c339)), closes [#6660](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6660)


### Bug Fixes

* : The toggle arrows in xyne-desk will follow the filters applied ([afef1dd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/afef1ddf592dc9f75c3242b65b62a559ec2c5faf)), closes [#6385](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6385)
* Add strikethrough formatting to dashboard chat composer ([8f34d38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8f34d381351338312b8035b3b5414e75a64ee838)), closes [#6339](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6339)
* Add syntax highlighting support for all additional languages ([fccedba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fccedbac5b3f9e6da5c4fc12f11eaff7d9852655)), closes [#6631](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6631)
* Add text-foreground to LinksTab inputs for midnight theme visibility ([3fe66cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3fe66ccd2a9feb5ad65907ded4466d7d99dc5edb)), closes [#6471](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6471)
* Add ticket type filter ([3e994ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e994ffcaee383a942bfb50946fec3360440b854)), closes [#6650](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6650)
* added version check in desks ([bd8532d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bd8532ded12dadf5c1a31609cbc6a6e0f39ce8ff)), closes [#6551](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6551)
* create canvas API ([9bd82b6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9bd82b62c18804dbd5c934a5252a4d96119d80b6)), closes [#6620](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6620)
* electron duplicate tab browser and shortcut fix ([027a552](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/027a552f01e11cff75d560202e91291facf15e6f)), closes [#6453](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6453)
* exclude call summaries and other AI canvas ([4871da9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4871da9fbb19ea6a03f406afdcb8373421ab5a53)), closes [#6532](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6532)
* fix ([e008541](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e00854111d9715fce761cf058a4e9e48f9dbb1de)), closes [#6413](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6413)
* fixed tickets query ([8ed2ffa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ed2ffac706f23667112f8e448448498aaeb0040))
* fixes live preview of copied ticket link ([5fbc181](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5fbc1815318df1c6f07d6903e16caae8f732ad37))
* main fix ([c2a559b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c2a559bc7e67eeef9c875f25eba5c2ad216f8b11)), closes [#6636](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6636)
* mark channel viewed main ([0c0a53a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c0a53a4699a53077182ee0a4e4cfda7aec3f0ff)), closes [#6567](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6567)
* message change ([288364c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/288364c37d8a32cc0cccbbb37e884073264de756)), closes [#6623](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6623)
* muted channel highlight in sidebar ([1ef8502](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ef8502bcc28d7f1432e92f37591e4deeccdcd27)), closes [#6601](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6601)
* open in new window for electron in search navigation results ([345e57c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/345e57cfc8b1b9129636861f7e83dc6dda37503a)), closes [#6178](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6178)
* Populate lastReplyAt when creating conversation participant on first reply ([0a938a8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0a938a82d24a79e210fa7ed062f13a00e9dafb3c)), closes [#6558](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6558)
* query fixes ([a4376fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a4376fec9150a2bc2c8354224561b015d7fec7ac)), closes [#5635](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5635)
* rate limit mutations by batch size instead of per-request ([adc4ff6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/adc4ff686c0d44266dfb3940049681f6d9855364)), closes [#6571](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6571)
* Redesign ticket view UI ([483310b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/483310bdb565462ca25575b68c4932d1fb3a6493)), closes [#6475](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6475)
* remove Status Category field from ticket details screen ([7df51ee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7df51ee76855ab12048ca7012a974d5e8e484b36)), closes [#6341](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6341)
* revert lazy-load tags in CreateTicketModal instead of fetching all project tickets ([5b1a000](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b1a000472e83a6d7663ecd2ca8c863a19248b00)), closes [#6569](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6569)
* tag [@firstname](https://ssh.bitbucket.juspay.net/firstname).lastname mentions in chat composer via Enter ([cc4e32b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc4e32b1fb6ba91590949e9b19e9628a195503ea)), closes [#6647](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6647)
* text overflow in markdown messages ([ec085f3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ec085f3ccf022387570255f8a2a040a642b523c5)), closes [#6523](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6523)
* Use lighter text color for unread channels in dark mode ([3bb547c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3bb547cd0ce7b7ecfeea3d899055ea6040dd72cf)), closes [#6565](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6565)
* user resolution ([36ce935](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/36ce935847fddeca3d7b2c618f1a517b62de42e5)), closes [#6624](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6624)
* xyne apps screen permission fix ([a006fa8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a006fa823bcdd2b7e9d5bf1a3b581c35bd735ab4)), closes [#6481](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6481)

## [1.146.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.146.0...v1.146.1) (2026-05-21)


### Bug Fixes

* add rca mapper ([c22a2c4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c22a2c4e45ecaeb3476754c8e6c656cf384d17be)), closes [#6549](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6549)
* allow dot in @ mention query so firstName.lastName usernames work ([75b384b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75b384b4aede91c05c73cc144733ac46b870fe0c)), closes [#6338](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6338)
* cmd+return to send message ([6dfc6fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6dfc6fbb50683741f7e2045c5481c25e0ef0f899)), closes [#6429](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6429)
* preserve single-message attachment upload order ([d2f38b3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d2f38b32753675cf7c18c76c80c50b08f0ac7d4c)), closes [#6431](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6431)

## [1.146.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.145.1...v1.146.0) (2026-05-20)


### Features

* revert model to private-large ([f30187a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f30187a719f380b10b33f4047617a8c2497c2658)), closes [#6531](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6531)
* Store lastVisitedChannelId per workspace ([bbcbe70](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bbcbe705fc5b891b9873a7b5caf967284efaa3f6)), closes [#6517](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6517)


### Bug Fixes

* add workspace id backfill routes ([354b037](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/354b037838f239b5cb0a7c801d863fc2e160bd0e)), closes [#6448](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6448)
* External call sync ([d6ea4f4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d6ea4f461581dbc6c1703fede640defee0284a23)), closes [#6548](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6548)
* External URL handling ([7064e3f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7064e3fd70636ec301b0272dd7c0681cb8165407)), closes [#6488](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6488)
* Invitation template update ([261212f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/261212f6288318060f508e7ccfaa7f1e5dbdc660)), closes [#6518](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6518)
* Slack compatible endpoint fixes ([21b3166](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/21b3166f31912cb860af7682d994bfa9858794b0)), closes [#6437](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6437)
* support tab completion in mention selector ([dd34f38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd34f388d39b6de1e45e2698b31dd445a95b4fac)), closes [#6185](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6185)

## [1.145.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.145.0...v1.145.1) (2026-05-20)


### Bug Fixes

* add workspace and org level scoping in search ([da86212](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/da86212349e3f7c70e925b3b8fe85d7fc1683c2d)), closes [#6441](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6441)

## [1.145.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.144.0...v1.145.0) (2026-05-19)


### Features

* navigation from call activity ([d52df5f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d52df5f97182bb889e67de9d3396689b42a3656d)), closes [#6478](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6478)


### Bug Fixes

* allowing emails query for claw ([158b270](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/158b270b8f30a50073202c7b61e7a7affdcd746a)), closes [#6505](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6505)
* macros support added for canvas migration ([c57c786](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c57c786fd98901c1d75ed7c9db51800fcd327adb)), closes [#6438](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6438)

## [1.144.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.143.0...v1.144.0) (2026-05-19)


### Features

* add ticket stage reconstruction utility ([d664650](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d664650b054c89cc9a3000da1e3561b0f092d7a9)), closes [#6332](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6332)
* added isread filter in userActivitiesPaginatedV2 query ([501b616](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/501b616097f16e03c13d16e4b28e5eed83538485)), closes [#6384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6384)


### Bug Fixes

* auto draft and ux improvment in xyne desk ai ([52e2873](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/52e2873c6c1876cb0998ddd5e805bfc23d2a466f)), closes [#6110](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6110)
* fixed user resolver ([0f3e768](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f3e7688f6af0e08a6a2e5d459580b83a40e3ac6))
* Increase ticket description height ([6554df2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6554df23d83d265bfd26ea11ce51962199345c88)), closes [#6476](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6476)

## [1.143.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.142.1...v1.143.0) (2026-05-19)


### Features

* introduces scroll space saving for browser panel navigation and stopped remount of chatlist ([1c496f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c496f53cb6707d234b226acb9457346b87db0fc)), closes [#6190](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6190)
* sync-dm ([8634a22](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8634a22fde7fc033bebb3caf7502cc592d6bff9a)), closes [#6433](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6433)

## [1.142.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.142.0...v1.142.1) (2026-05-19)


### Bug Fixes

* channel search ([a3e45b2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a3e45b27adc3c95d1bd80a2e5f10a43f1a82e87e)), closes [#6462](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6462)

## [1.142.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.141.2...v1.142.0) (2026-05-18)


### Features

* Add external browser setting to profile ([b9a84b3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9a84b3428ee3635f41869e5ab0ec4a7262886cf)), closes [#6308](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6308)
* clean preferences UI : dark mode and voice section removed from profile ([4936234](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/49362346b0212a19917e9fa7d92e9e0a3b81eae3)), closes [#6445](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6445)
* Feature/ticket analytics revamp ([11cc015](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/11cc015b81c3e6050b312890abd1ab04aaa035ac)), closes [#6451](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6451)
* force logout flow using iat ([7e7e6eb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e7e6eba36933b67a5a6754adec219114d404f53)), closes [#6426](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6426)
* mtls invitation fix ([63bc373](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/63bc373577a6881f31750dd2606acc3c51bd37c4)), closes [#6370](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6370)
* replace xyne-app-issues channel ([575aba3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/575aba3e6c649910bb5124bac8aa50472794f815)), closes [#6224](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6224)
* revamp mobile sandbox and prod config to use new gcp, fcm projects ([3883f21](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3883f21fb6b007ae8331924c2e339c2826a0079c)), closes [#6428](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6428)


### Bug Fixes

* .related('project') from userVisibleChannelsV2 to reduce sync payload ([70ec449](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/70ec449b8d68d6d14159e367c945ce9f92100cb2)), closes [#6417](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6417)
* Attachment changes revert ([fb41f01](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fb41f01d1ca900eb435c16551504da67ae5531e9)), closes [#6419](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6419)
* made personal canvas collapsed ([dfb0f97](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dfb0f9746ece5341d75cb3c2e1e9b25ee46c1ea1)), closes [#6360](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6360)
* providerUserId as google.provideruserId instead of user table id ([00ec8cb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/00ec8cb637da52ad998ce116e6ebeb58a7122fab)), closes [#6442](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6442)
* route Jenkins to cucumber by default, gauge behind USE_GAUGE ([4d114b5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4d114b569ca3b2a68b7a6d782c657de1ab88891e)), closes [#6418](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6418)

## [1.141.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.141.1...v1.141.2) (2026-05-16)


### Bug Fixes

* darkmode fix, reduce delay between pending and actual msg, thread attachment legacy fix ([573de01](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/573de01377aa09a2bb3886e75a3fb56752279f01)), closes [#6403](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6403)
* filter threads section to show only subscribed threads ([08fe979](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/08fe97981a512954d31188a4461f0280e4c9ff08)), closes [#6377](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6377)

## [1.141.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.141.0...v1.141.1) (2026-05-16)


### Bug Fixes

* rebasing migrationDeployment branch ([5d3978a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d3978aa3feeae805d02c0aeba7649fb9c49a483)), closes [#6350](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6350)
* show tooltip for all mandatory fields and unify submit button color ([3677dd7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3677dd754c1f67275727a3abd3d3523697d97850)), closes [#6249](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6249)

## [1.141.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.140.0...v1.141.0) (2026-05-15)


### Features

* add camera overlay to mobile profile avatar ([26d913a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/26d913a96ac7adede77aea23b2c546c82f74c92a)), closes [#5453](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5453)
* add confluence migration ([fc7427a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fc7427a6a7cffdef01a6a2c0e8613dcb7609876f)), closes [#6353](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6353)
* add low-latency voice input in chat composer ([f592929](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f592929d88ded4613fe071227ea1a2a48becc53d)), closes [#6227](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6227) [#6247](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6247)
* Add outage alert service and integrate PDF report generation for false outages ([25f5cef](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/25f5cefbe34b5c3a9bcac905c04c23bbd1ea2b9d)), closes [#6000](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6000)
* Add Participants option to calls ([bb3198f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bb3198fbac8410bc70efd993b09cdf8ed962fd85)), closes [#6264](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6264)
* added conditional semantic search on vespa queries ([418c443](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/418c4433180b660b0a733bbebe73bdab4d4c95b9)), closes [#5713](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5713)
* added slash command support for apps ([89db875](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/89db875150694e28a3928af5609955a80de356b6)), closes [#5924](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5924)
* clean preferences UI fixes ([6932f53](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6932f53edc41cad5b9c006922128e387a6152302)), closes [#6321](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6321)
* confluence migration implementation ([7147e87](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7147e87600507aa689f869630550ba063a95a426)), closes [#6260](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6260)
* conversationAttachments files/info files/download api's for apps ([4797c1a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4797c1a836c13a4d44dd59b256546b3c9c419b30)), closes [#6379](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6379)
* Handle call shareable URL with workspace ID ([9764eda](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9764edaf68f87ea8f4e2d6319b0e8481d2632503)), closes [#6378](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6378)
* Meet with feature for calendar ([2cd6642](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2cd6642785a632519ee6da60e816451a28e09cf7)), closes [#5357](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5357)
* Preferences UI ([e13d877](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e13d877f83852a81cd42a3a9e973e17047caf017)), closes [#5653](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5653)
* SearchResult Screen ([699920f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/699920f2da2fcac41bed03385c06226487200a2b)), closes [#6174](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6174)
* ticket route fix ([689d8ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/689d8ed135dbaaba910374ffb859ad08a810ccc2)), closes [#6278](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6278)


### Bug Fixes

* [HOTFIX]added projectrecap to fetch prompt from langfuse ([af49098](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af490981d52dcdc344d8bf26bff80e5daa2653d3)), closes [#6311](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6311)
* activity selection fixed and added unread mention dot ([317e8ea](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/317e8ea0c222a4f063824559964b100327d14ef6))
* added 3 tier sorting logic (mic > camera > joinedAt) ([63cddf7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/63cddf7040fe31944d461823191735a31874d9a0)), closes [#6331](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6331)
* added focus management in missing pages ([e4c0ad3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e4c0ad37dbd9bab5ef7f323d2715d62d93193bb9)), closes [#6087](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6087)
* added ordering ([2bb55fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2bb55fb95d8bd08c786b8a25b8b51add18187cbe)), closes [#6388](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6388)
* auto-assigment logic update ([4c8b96f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c8b96f7d2cabd880fac28a463f690b46ee83956)), closes [#6369](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6369)
* brand name correction added to call post processing actionables. ([6711580](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/671158023515055805f006f099bb03490bdabfa2)), closes [#6300](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6300)
* Chat with Transcript ([3661dcb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3661dcb73881d587e446a9c0a018468e1f4d5b05)), closes [#6269](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6269)
* checking for what to select if we have auth + invitaionId ([9a00e6d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a00e6d8bfb924c02e7ebed00b0cdfca282b28e0)), closes [#6307](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6307)
* cookie forwarding main ([5f84eff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5f84eff4df2b235818f7e972679d927216a18884)), closes [#6337](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6337)
* exclude null participationType users from instant call modal pre-selection ([924d250](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/924d2500d1755b4af5d85cc57ffaa52f024c5876)), closes [#6326](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6326)
* Fix calls appearing in scheduled calls for broadcast channels ([2c4e6d3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2c4e6d396d2ee65449686224a7caf0c01de804f1))
* Fix group DM call participants name on edit ([70ed1f3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/70ed1f3c1237edb0cdd596a0375c1dbbc86623c9))
* Fix inability to open docs - routing issue ([e18a2de](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e18a2de62908a63f9b450c5b267a88c40c5e61fe))
* fix list view public canvas ([a1597ad](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a1597ad2b652a09e142df9d77e9f87f853d35775))
* fix notifications ([79bc220](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/79bc220b24e30f9f79353118de7ea43074b3bc1c))
* fix personal canvas and darkmode changes ([3aba2ba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3aba2baf6ad31d414bae1833b9d9419f57a9e817))
* fix the ticket filters selection ([d0df78f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0df78f8d39017068dc3414aad46e3d07553c8b3))
* fixed dark mode issue in schedule call modal ([71ec203](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/71ec203f52b34ccac20c5dff52b4a6825558b844))
* fixing the microsoft sso for new user ([e8e6d02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e8e6d02ad81c60c9327860ff4577131c491d9959))
* groupBy state save ([c6a07d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c6a07d005a2d03312f75d10d2dcbe566be8688b4)), closes [#6303](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6303)
* job addition ([aea0644](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aea0644f92f1e00672daa9bc3f7645c2e5e5c2b3)), closes [#6240](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6240)
* making backend send mutator backward compatible for old client ([49c3fb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/49c3fb6fdef9228875fba33175b04bfb5dd9f558)), closes [#6346](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6346)
* PendingUploadRef cleanup for failures ([9cc1342](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9cc1342b2e0e0be15baa656d48f204d173cc23dc)), closes [#6284](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6284)
* removal of edit button from team name and manager name ([f4f0d4a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f4f0d4a38a0ec6987722361f05c67282fd05b1f9)), closes [#6215](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6215)
* remove .related('conversation') from userConversationsPaginatedV2 to reduce IVM load ([ba4505f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ba4505f285b0e10ddbadbe22d67c27cd7fd1ab75)), closes [#6263](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6263)
* Remove Jenkins skip condition that bypassed builds ([fd50be7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fd50be7601e563ae9fe3377547ecd946be9c86d8)), closes [#6365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6365)
* remove syncing of display name ([db47c88](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db47c88ccb5486f49f4afc3dc06994f2ea2ac123)), closes [#6196](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6196)
* skip unnecessary conversation query for non-empty forwarded messages ([c4a5bab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c4a5bab724541688627178cd31e618d97d400941)), closes [#6252](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6252)
* ticket-creation-issue ([c04df2c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c04df2c43fed7db0677add2a94f161cfb5a85d51)), closes [#6324](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6324)
* use workspace cookie for agent auth token ([f2c70fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f2c70fe60438888cfe1ab452793f2b9378d60828)), closes [#6246](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6246)
* userMentionfix-emoji-render ([bbb6827](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bbb6827867c0c4c3944025ead790db76d21a9db0)), closes [#6292](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6292)

## [1.140.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.139.0...v1.140.0) (2026-05-12)


### Features

* add-redirect-to-ticket-screen-if-not-found ([649b5ae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/649b5ae7834b159b4282c6aec47858ce075b7a72)), closes [#6152](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6152)
* added all canvas in the hierarchical ways ([27de0f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/27de0f5a8eca804d052a648b537c81265ba65287)), closes [#6203](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6203)
* added linkedConversationId check to enable cutoff ([22b8d86](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/22b8d865ae5ab8e51f8d2fe1d9d22523acb3823c)), closes [#6208](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6208)
* Changes for Notification caching native ([1a658a0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a658a0ce2f89dca0b5b3ae8a9f106c9f489e8b5)), closes [#5982](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5982)
* electron ingestion api ([25f6270](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/25f6270ddd8ee1844e20a66360cf6d5bcb5745c2)), closes [#6163](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6163)
* electron proxy for memory ([6674824](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/66748246c810bd601cafe0bc02a8e9d2016a073d)), closes [#6138](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6138)
* enabled caching for canvases and activities ([1b57194](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b5719447cbe5138da8dfd794e491026b5c3d225)), closes [#6173](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6173)
* fixed render of fallback text ([a16b00e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a16b00e00ad1675918714db174eb4812990c2d26))
* Large attachment uploads ([01fc18e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/01fc18e2a56e11d315c059d4d00a455b3c49556b)), closes [#4836](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4836)
* memory plugins ([57bee6f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/57bee6fba60d75168d10d3d5cbb47fb3b7863b66)), closes [#6214](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6214)
* mettle user webhook and location wrapper ([1b24c92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b24c92d1a64f921ce57a0d74e4dc33770cfa661)), closes [#6120](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6120)
* Showing ChannelParticipants From Vespa Mention User Component ([12a2748](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/12a2748a31f8c7915a0d41ab7434125ec3d74ed4)), closes [#6147](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6147)


### Bug Fixes

* FIX DELETE SENT TO CHANNEL ([fa1745c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fa1745c4308b009d9f4f65e2955daf7e0553d629))
* Fix login via invitation for external users in Electron app ([bced218](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bced218c29a193619a1662cc90af9a3c5f70a774))
* fixed dark mode issue ([8c273ec](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c273ecef8ec1087d718c34d2fb2a9f8fbaee873))
* highlight active activity item in activity list panel ([7577191](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75771915cf49a4c9c71f9490dc782189df3ac553)), closes [#5859](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5859)
* inactive check on login ([f7675ec](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f7675ec23ee1a71c477548c074a62875d2c94ee7)), closes [#6161](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6161)
* Jiraffe migration fixes ([6ba1a82](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6ba1a82a53db664dbc377bb018f62c178b560ad1)), closes [#5131](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5131)
* mention user fix ([f2845e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f2845e4ea117e81f34980079608164e82ceaeb3e)), closes [#6184](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6184)
* restore message to input box when server-side mutation fails ([dcfa7e0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dcfa7e057aef0a6b6a29e7b40341293788112c7b)), closes [#6189](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6189)
* Revert knowledge base with Ask AI. ([f270f7d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f270f7d88eb9c74de3e958aa3410bf51c4b991b2)), closes [#6129](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6129) [#5751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5751)
* revert pr for in a call ([2ef7075](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2ef70755bca3b0da6169e8ee542b164e654f0d91)), closes [#6140](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6140) [#4365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4365) [#5757](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5757)
* show CC by default and sync ticket subject on email reply ([3e0e764](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e0e764b75f480a50b2ec5783b0176970b5739de)), closes [#6106](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6106)
* ticket preview ui fix ([1fd2d8f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1fd2d8fcfb170c7488cfcd2ef51d8c013c28ddb0)), closes [#5968](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5968)
* user profile acl fix ([3abec7f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3abec7fcdfbef779766f8db9324ddbfbe272789e)), closes [#6149](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6149)

## [1.139.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.138.0...v1.139.0) (2026-05-11)


### Features

* add auto email classification for XyneDesk ([40a80e3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/40a80e3066c0c260543398bfaea5998bee4f3599)), closes [#5831](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5831)
* add channelParticipant model in the allowedModelss ([8f3464f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8f3464f46a0124415f2cc7a3777d6c0b748cf2fe)), closes [#5031](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5031)
* add logging for browser link clicks and panel interactions ([00ee6a5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/00ee6a514fa4f04bb87501a93cf303c562a9614f)), closes [#6037](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6037)
* add parallel test execution and gauge migration ([1291aab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1291aaba2820ce2a5443d9895454d835354ef4ee)), closes [#5657](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5657)
* Add tooltip to disabled create ticket button ([054984f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/054984f4579891432e7990c3d6cb96c05f25625f)), closes [#5669](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5669)
* added blockit to flowJSON transpiler for both slack specific endpoint and postmessage ([460cbb7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/460cbb7565aaf24f42407c9fae329e1961f9eaf5)), closes [#5948](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5948)
* added conversationSeenCutoffAt column and query on this for chatListV3 ([c65212a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c65212afa0615d37bc854d450ef6228d6f063cc4)), closes [#6017](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6017)
* Adding J/K for all lists ([784de38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/784de38a760ec07bfa6b6f346a5e9d9782f5480b)), closes [#5734](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5734)
* ask  ai <> claw ([7f22ba9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7f22ba9dc2745e454c1d5a234b80eaa9987dcc9b)), closes [#5856](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5856)
* darkmode support ([ac26dc5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ac26dc5d8fc4336b8d6c6706f28029fb6309f4aa)), closes [#6033](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6033)
* Delete a call from calendar view ([e4fb134](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e4fb134c96f7128e352cad23ade1677469f15106)), closes [#5750](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5750)
* drop older logs after 2 retries ([88af4d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/88af4d0932e092b5f72bba772a3c32ada3689852)), closes [#5743](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5743) [#5721](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5721)
* Feature/XYNE-12930 add workflow ([2c43252](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2c43252730f2d8139e1eba69522dbe3333db3bf5)), closes [#5833](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5833)
* few call bubble updates ([3666022](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/36660229b1292330583ba0c33dda95a814ef0130)), closes [#5946](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5946)
* Fix invitation flow redirecting to Electron app ([298d88a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/298d88a55d12783b0feab4df803382f6af3c8ae6))
* knowledge base with Ask AI. ([317fbdc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/317fbdc92d2351319616da5af50624a93cc973da)), closes [#5751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5751)
* make id's Visibleee ([3356003](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/33560038413597e4d78477ac78d3ccac8a54c322)), closes [#5182](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5182)
* remove xyneId unique index ([2dbb003](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2dbb003a3c4843b601f063145784045811a17318)), closes [#6009](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6009)


### Bug Fixes

* : fix duplicate mention in release-canvas ([504423b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/504423b58e848cd8878ab0aa79ee0fb263b87c68))
* Activity for declined call ([7e33b53](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e33b53e56f827ae43f0c3e59ced1b4072d91dd3)), closes [#6047](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6047)
* add darkmode fixes again ([d834475](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d834475085cfc67f60a5746cd01dd1c1f9d81d2c))
* add darkmode fixes pt6 ([3df6e14](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3df6e140a4881234d983f8b9933e4c968ac49ac7))
* Add kanbanPosition and classification fields to ticket schema and related components ([ef94735](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ef9473540bde0c478a698ce1b191ec666fa4691d)), closes [#6006](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6006)
* add markdown codeblock shortcut support auto-convert ([b9801db](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9801db59c028531ae8d5c15bec386df6fb7f1ff)), closes [#6016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6016)
* added claw exposed endpoint for ticketAttachmentCretion ([c209f71](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c209f7170045957f8d20312032c51ee47cb8acd4)), closes [#5918](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5918)
* added correct stage update for declined and deleted events ([72c862b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/72c862bf70053db98708158e4b959b9085da5068)), closes [#5885](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5885)
* added default notification setting ([afa0629](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/afa0629cae8e82ff6c225a30ca9808e6c1cd82bc)), closes [#6063](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6063)
* better seed data ([b92ab9f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b92ab9fe4596a6908c850f988344ba6af35d68c7)), closes [#5827](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5827)
* bot identity fix for workspace ([ebf8c0b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebf8c0b9b21c3d70aebee995c76f02f3761aba4e))
* canvas list left drift ([9b37e82](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b37e822ba1a9275b7b3b60eba8e05395fd588d9)), closes [#6100](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6100)
* change dms visiblity, and error drawer on mobile ([bbcfa8e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bbcfa8e13a29024fb872cbd009de6dd61ae4f28c)), closes [#5945](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5945)
* changed env variable to use the hardcoded spaces domain ([4b45aa5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b45aa51560fbda35386db0dc873878cefad9270)), closes [#5939](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5939)
* external users env update ([fe4ce1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fe4ce1b1f823f3876c3408a4de26085d2bfc18cf)), closes [#6032](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6032) [#5988](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5988)
* file ingestion using docling ([ada2c0b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ada2c0b63b899d923d68445d2cdd72e12013855a)), closes [#5676](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5676)
* Fix mobile app crash on first open ([a8e1e3b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a8e1e3b3734a5545d4d601ca2ec75c4a65a8a6d2))
* fix the self search, and add it for mobile ([43e775f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/43e775ff08edf1e544fbadb66bd5265da818de99))
* fixed dark mode issue where divider line was appearing in light mode. ([7b447c8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7b447c8427fd2437ea235cfbf1a1071a42025dae))
* fixed navigation from cmd K for support tickets ([9eb268c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9eb268c230da78fc73ef47db26586958c9d93d88))
* fixing assignee for searched users not being visible when selected as assignee ([35e6aa9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/35e6aa9a155cf11d9e2e3f4b58868190fbd6e283))
* fixing overflow of channel descrip. in activity due to long urls ([97cb85c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/97cb85cf0c581f22575dcf6d327723fceb6bf932))
* fixx attachment preview close issue ([2b4da3a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b4da3aea7b42378a9b6690ed53e2cfd40dc7909))
* fixx user sub menu not clickable ([2ecc910](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2ecc910b41f5ce4c3938022f6361eb4a68127f46)), closes [#6086](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6086)
* inline attachments, reply all and bug fixes ([1da5bc4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1da5bc46f030ae178666d9356aeb82c6a7263e30)), closes [#6015](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6015)
* minor arrow change for collapse ([0f09260](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f09260e6a29e5401db4d6fbf2a99ef800dffd90)), closes [#5435](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5435)
* modified the notification service to pass workspaceId and modified the fast chat loading url from /chat/dir to `/ `only ([937365b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/937365b38c64cae771319b4e6d9e1ab324ab4d1b)), closes [#5927](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5927) [#5893](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5893)
* Optimize user threads query ([72e6a05](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/72e6a05b55ee1580fdba5783950324ede78f1eba)), closes [#5919](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5919)
* org and workspace fix ([e73babb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e73babb1dcf14399b3acef878d43aa68a4e110c2)), closes [#5887](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5887) [#5848](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5848)
* query change for recordings API to O(N) from 2N+1 ([9a1054c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a1054c6e42feb5eb2de6871b2390d86be73e6d5)), closes [#5840](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5840)
* removed complete vscode from repo ([abc4bcc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/abc4bccbffa29f7ec3f3150721d557d81aeaa56a)), closes [#5873](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5873)
* replaced runtime default to const ([7440dcb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7440dcb85330b17ccfe70f6a67ada444f389be99)), closes [#5916](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5916)
* revert2render via HTML ([4b14891](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b14891ede48fd75e499abbfd84c1c2e07d2341a)), closes [#6122](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6122)
* scope fixed test auth to sandbox:test ([82c88ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/82c88ff42fe20e513403d8d763363ae885af6d5a))
* show custom status emoji in CMD+K and CMD+N and user mention ([6b8fb8a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6b8fb8a8cb8b147dd15e6bc278adfe88bc7290b0)), closes [#5604](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5604)
* sort calls by scheduled time to prevent recurring calls being pushed down ([a915e42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a915e42142acec46fce669c478d65a059e52a774)), closes [#6041](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/6041)
* ticket board change fix ([157c855](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/157c855d2565c8d18e2656c84b8f16b7699c5d3f)), closes [#5925](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5925)
* url fixes for canvas ([cdece19](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdece191f227c706d800de814da24662e8e9f939))
* use Bitbucket PR changes for workflows-only skip ([dd0c78d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd0c78dffa3d9ecc3733f3df6292437840687a54)), closes [#5962](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5962)
* Use new conversations query for threads section ([ebc27af](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebc27aff343d01230ad371012e523cf198a98496)), closes [#5976](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5976)
* xyne apps auth fix ([a338909](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a3389093ac466a1f8fdf78af4a3fbe98d2185309)), closes [#5940](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5940)

## [1.138.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.137.0...v1.138.0) (2026-05-05)


### Features

* - Feature/with filter ([7e96cae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e96caeac6b09d2ac271442b6b550eea56f6ee4e)), closes [#5490](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5490)
* Add support for pinned message for a migrated channel ([6440007](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6440007b2dd97bc0b480b5032463c6acfb21498a)), closes [#5909](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5909)
* create canvas API ([5eaf6b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5eaf6b9f988a6c03680ab5fec48a3fa1e2d01abf)), closes [#5749](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5749)
* Feature/desk mail v2 ([2ffa799](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2ffa79910252926bff104405455181650cbc152d)), closes [#5832](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5832) [#5806](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5806)
* merging claw back to main ([55d3056](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/55d30563726af6cf93e8f617eb7053b6c270aa60)), closes [#5822](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5822)
* paginated canvases ([e02aa7b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e02aa7ba16949cd767e8ee0c5fd723df776632d4)), closes [#5837](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5837)
* Participants-synx-in-migration ([fb42605](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fb42605ea8fd655e9e40a96a9c413c89732865d1)), closes [#5899](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5899)
* Slack-compatible API adapter layer ([8730f77](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8730f77f44110d24dcd15a39aef455913178a817)), closes [#5864](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5864)


### Bug Fixes

* add markdown codeblock shortcut support auto-convert ([e7fd672](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e7fd67248e8d81e5d9c5a8d1adf8ac53f9aeaccf)), closes [#5683](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5683)
* added empty drafts filter in frontend ([7fb007f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fb007f06cdc8e67cad0488ac1d22964b6349f65)), closes [#5795](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5795)
* Broken ticket UI for markdown table in ticket description fix ([9e6e4dd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9e6e4dd821a295447d916df0c1e2f6921293543b)), closes [#5879](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5879)
* call-thread-switching-context ([76649c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76649c34173787bfbc5c6d64c5c34f2d08420ea2)), closes [#5575](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5575)
* changed env variable to use the exsisting values ([0c540fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c540fd1045231035c0366066c3b7f3db802af70)), closes [#5869](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5869)
* create seperate build config for sentry ([0d001fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0d001fbf8877d226824e95f97d6b77ab574ae1e3)), closes [#5780](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5780)
* exclude email messages except threads ([66cd977](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/66cd977dadab641c86f80348308a6c8ddb5dd1f2)), closes [#5898](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5898)
* fix channel all notification ([20561a9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/20561a9f72431cb2a141e777d44eae05dd1d3a62))
* Fix DM page top section behavior with long messages ([67c58eb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/67c58eb2ab85abb7ba6b78b90b42c3d452842e10))
* Fix DMs page opening in right panel along with Dm, cavas was not opening in Mobile ([cc2d2e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc2d2e903b1d459221dcb8f5de43c9da14d17ed3))
* Fix pill positioning above first message ([2fd8d2f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2fd8d2fe67e6781e8c201b1a8cd48c7a28d80bd7))
* Fix unnecessary thread panel opening on channel notification click ([06cd52a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/06cd52aee98a3b858d0e50f35475adae3b63faaf))
* fixed activity second click scroll issue ([3a7286a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3a7286a74db55b0e02e9633a03ee1b237381e17a))
* fixed navigation from cmd K to include channel id for desk email ([e268f2c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e268f2cf3cd58339459e19f04fe73e218cb9d724))
* lazy-load tags in CreateTicketModal instead of fetching all project tickets ([df91bcc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/df91bcca7870c333a08df013b206b0ea9c7e95fd)), closes [#5762](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5762)
* link issues ([83494ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/83494edb64d942e456d3d7d40b5635cd3463b160)), closes [#5857](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5857)
* Made docx, pdfs and videos zoomable ([926b782](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/926b782230c890d590c6e64bfe75936e2ed89ce9)), closes [#5849](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5849)
* optimize user threads query ([9e0bf0e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9e0bf0e2a8ed5ad53faf899f61862603b93dad80)), closes [#5876](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5876)
* support dropdown flickering ([4027b94](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4027b949a01e3e65eec780948c818313beae2aa3)), closes [#5882](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5882)
* XYNE-13110 Fixed Status Modal ([db0989e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db0989e99b753373934a6d8191ecb9b9a37e1b23))

## [1.137.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.136.2...v1.137.0) (2026-05-02)


### Features

* xyne desk improvements ([fff5515](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fff5515f91bbd43b4ab217b1e0035be16ede2952)), closes [#5824](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5824)

## [1.136.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.136.1...v1.136.2) (2026-05-02)


### Bug Fixes

* mail permission schema for desks ([9c2f79b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9c2f79b4ae594aac252290ac733b281c08fae9cc)), closes [#5807](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5807)

## [1.136.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.136.0...v1.136.1) (2026-05-01)


### Bug Fixes

* xyne desk fix ([16d4b4b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/16d4b4bd47ac130dd7d632696d4a483968cd6964)), closes [#5730](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5730)

## [1.136.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.135.0...v1.136.0) (2026-05-01)


### Features

* Add Slack-compatible incoming webhooks for apps ([c4316be](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c4316beb61645d3957024df7084baa7c9200a7ce)), closes [#5755](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5755)
* Handle stuck presence call status ([365bf0e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/365bf0e0c365a56ea7d9caa258d9680fbb61ad4d)), closes [#5757](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5757)
* revert making a common component to render the virtualised lists ([b6eb30c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b6eb30cf6a413c100ce48ca7f8a831616f7cdd97)), closes [#5739](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5739)
* user_deactivation and reactivation . ([2aac41a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2aac41aa9380f3be4975f7704b8acf725ecefb37)), closes [#5696](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5696)


### Bug Fixes

* clear error state when transcript data is successfully received ([8ac9ce7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ac9ce7456ba71e2653193b68665da1fe3452a04)), closes [#5790](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5790)
* fix in error reporting modal. ([54b7d64](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/54b7d64b9ce2153e3f982756912d047a641065dd))
* Fix last DM visiblity in Home tab, also fixed analytics screen padding ([963b71f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/963b71f5fb475e3af78d2f6162c45fda3c8bd9cd))
* fixed css of info component to show last member ([c4872e5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c4872e59112db7aadf090a66343dc17d870dae47))
* fixing logging out thing ([6b73d15](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6b73d15f91b762f5ee7a4714a96aa86366a7427b))
* fixing the AI_Summary prompt." ([197c2be](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/197c2be0d562629ae9343c77ab1c7f219f251d85))
* handle tracking sideEffects on batched mutation request ([4e300e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4e300e4501a7a22d28f99541456c87fe9bdc8d6e)), closes [#5740](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5740)
* passing workspaceId and all required thing in auth to mobile login ([c1e1301](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1e13014139ab67b9efc10d375eb9b04b357cabd)), closes [#5720](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5720)
* ticket UI fixes ([782689d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/782689d2eb682ddc41ce8e8f2fea63268d468cff)), closes [#5461](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5461)
* Workload sync ([4c8618d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c8618de62a33c75f440aba802712262cadc2993)), closes [#5735](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5735)

## [1.135.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.134.0...v1.135.0) (2026-04-30)


### Features

* add error reporting to a channel. ([f9bf5cb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9bf5cb716c948c3c22d5d2ac89864a8a7ee1ddf)), closes [#5236](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5236)
* add self-message via CMD+N and DM search ([b2c6db1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2c6db11c8c8955aa698e3784ae80011a9ab1032)), closes [#5413](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5413)
* flowJSON V2 ([e0dc4b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e0dc4b8f2f99017b4e40466aac6cee7f2704ebf3)), closes [#5727](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5727)
* xyne desk- email fetch range and mark as read + counter backfill ([86456ea](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/86456ea9213637fc0866ccc62e115c7400643ed5)), closes [#5687](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5687)


### Bug Fixes

* added auto focus frame work for input feilds ([5b2397a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b2397afa4621eb2574dcf692c37d64ae6806825)), closes [#5039](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5039)
* Fix image preview cropping issue ([1f5f27b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1f5f27b2479d3ba444e1dc276ee6160b84fce4d9))
* Fix org invitation rollback when email service fails ([ac41cf4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ac41cf4a18ab6281ab8030f2f6b0843f3ce3857b))
* fix profile icon click behavior above avatar in sidebar ([dcb254d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dcb254d38dd813224ea4672214d2f77ac366a856))
* fixing the AI_Summary prompt. ([9b2166f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b2166f8d4cbf2516e1e4c1c5246829c71a648e6))
* Resolve raw userIds in group DM to channel conversion ([dc75c21](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc75c21ee8922dd5e87158ff95ff00d782eec842))
* skip no-op channel_user_status updates in handleUnreadCount ([afc1f60](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/afc1f60d979a10ca15965388bd3ed752d15c4bc6)), closes [#5707](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5707)

## [1.134.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.133.0...v1.134.0) (2026-04-29)


### Features

* Add channel sorting options: recency and alphabetical ([146245e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/146245e7e5aae55e3f27376533c0eee2ac866784)), closes [#5438](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5438)
* add schedule call nudge from thread ([aecafc2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aecafc2487b95b4658e11d3f12c750d03b7a9b64)), closes [#4900](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4900)
* added ref updated and deleted webhook handling for pull requests ([43c84fc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/43c84fca31040d56132a0448f2a0eb9bb359d62c)), closes [#5401](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5401)
* added ticket preview via key press ([65a922b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/65a922b3a4c1326030ff470eca9178ba3ac2cae8)), closes [#5623](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5623)
* Feature: Show reply count and latest messages in thread view ([10e4b60](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/10e4b607c0e4d6af04baa4009bba8f8f5386a1ca)), closes [#5074](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5074)


### Bug Fixes

* added mweb padding for the record button ([db875c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db875c251b6e54ec20f6b473dc9c72c17db64d48)), closes [#5674](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5674)
* Added the changes for the url and big text overlapping issue ([cb36ddc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb36ddcee5f41d8d95b932448696215483e6991b)), closes [#5663](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5663)
* audio capture state fix ([336306b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/336306bf8f3c20a43eeb3b0192bea7fdecf51c16)), closes [#5692](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5692)
* Fix attachment carousel bugs ([1a99974](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a9997474223c896bc6a8557f89ca8c2ff7b485e))
* pass provider as 4th arg to generateState for MS electron ([6d9d76e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d9d76ebf95744ae5ef5813ec91920f658cd096a)), closes [#5717](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5717)
* system message opacity fix ([ea520dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ea520dcf96bf7989f21f793a0b66e0a330df0a94)), closes [#5672](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5672)

## [1.133.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.132.2...v1.133.0) (2026-04-28)


### Features

* add spec verification workflow ([88de886](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/88de886bec08317c5860ad29e13361f8e4cfe8bf)), closes [#5371](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5371)
* Added Mail support & Desk Support in CMD + K, made scoped search using CMD + F ([bfa1d09](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfa1d09b04ed9c8af8a617e14651492a65c15e1a)), closes [#5618](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5618)


### Bug Fixes

* added pagination to the recordings screen. ([ad29e96](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ad29e967eda1bd26a17a06213c13c59d106e0c7e)), closes [#5590](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5590)
* app users avatar. ([a581004](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a581004bf73e7f60f662e6ab4365c577bceb74c4)), closes [#5586](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5586)
* backend missing getAllFormsList ([8b65cca](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8b65cca971fc81368d1508020a9a2ab4b7d238a6)), closes [#5466](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5466)
* banner shown on tab switch ([29a6c85](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/29a6c851ce5011bd0e50028a66dea888a1733bd0)), closes [#5682](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5682)
* Calendar mobile view UI improvements ([c79e815](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c79e81547d32c5c4e3039e9103fdc7a128035551)), closes [#5605](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5605)
* callerUserId ([28a5bdb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/28a5bdbb893b8d509f62066e955c50bdfa226b46)), closes [#5660](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5660)
* deactivated users label in components and useActiveUsers ([1bbf391](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1bbf391602fb7b7f7d2fc86d65cea73998bd9b43)), closes [#5656](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5656)
* fix icon clipping ([75f43d4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75f43d491040c06584a4ca5d9039c806ed317d2f))
* removed bot list when typing @ in search bar ([a86a505](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a86a5053804030f810b92da6aa8f10fae0bd8e17)), closes [#5244](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5244)
* slack pinned messages ([306772f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/306772fcb7fae0b76e2d2e7edb80f0cda2035afb)), closes [#5569](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5569)
* support screen fix callInvite main ([29c5e36](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/29c5e36a5946971e00dc97c780095ed9c6a01d6c))

## [1.132.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.132.1...v1.132.2) (2026-04-28)


### Bug Fixes

* appActions_showAll ([c18ed8f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c18ed8f95b2ec7ec0f4d94c398c9684467695731)), closes [#5612](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5612)
* Email Suppport in Apps ([c1e4bbd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1e4bbd46ad70647ad6d8d20ed931c0427e062a5)), closes [#5616](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5616)
* support screen fix suggestions main ([c08e632](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c08e632c0b94836a38719f0f9af75e58fde2121d)), closes [#5617](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5617)
* workspace backward compatible ([3d48a1e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3d48a1e8f272e5f63fba79c102c00ece0aeea4ac)), closes [#5482](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5482)

## [1.132.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.132.0...v1.132.1) (2026-04-27)


### Bug Fixes

* add darkmode fixes again ([7a80837](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7a808377a1da4645b1a85fa3f59fc5c889bd5577))

## [1.132.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.131.0...v1.132.0) (2026-04-27)


### Features

* making a common component to render the virtualised lists ([cb76004](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb760042cf19d40bcab568601143e5d45589cb11)), closes [#5565](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5565)


### Bug Fixes

* fix for email in draft (from) ([59bd708](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/59bd7084aff61a4a8ebd059639838d3455e2e663))
* get selected field from vespa search ([b8d6939](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b8d6939af40b4d5dc9973a07622fa9aa7e4fe353)), closes [#5554](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5554)
* recording screen in lotus app ([2a124e0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2a124e061625e0c5cca4aa579a3e34d041a933fb)), closes [#5518](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5518)

## [1.131.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.130.0...v1.131.0) (2026-04-27)


### Features

* Schedule Messages & Drafts & Sent Panel ([eebb3b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eebb3b89da15a52c37f69ea188b7614c10ef25f5)), closes [#5049](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5049)


### Bug Fixes

* changes for attachment-upload ([4f9a6a3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4f9a6a30a23258e35a3db336952dad9468be7202)), closes [#5447](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5447)
* native app thread replies pill ([5a6aae3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5a6aae3e11720db9f9e83056a8822edcd26ddea8)), closes [#5408](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5408)
* route feature/local-bot and fix/local-bot branches to xyne-workflow agent ([28a125c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/28a125c884fefcd9fdae20da7f2378673e5c65b3)), closes [#5118](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5118)
* Support-Screen-bug-fix ([96abe64](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96abe64025d943bff2b13bcee43411cfe7fdb77e)), closes [#5562](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5562)

## [1.130.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.129.0...v1.130.0) (2026-04-26)


### Features

* added scroll fab for threads ([41187a7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/41187a7efd4d169f4ebdbfa47f087b3840b4fa2f)), closes [#5457](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5457)
* default as calender view ([94bcdf9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/94bcdf9a75f53e682296998cb10716666b5ec548)), closes [#5522](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5522)
* draft fixes ([6e2cbba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6e2cbba24aaf9b24cb5d1c9b671c93216966d089)), closes [#5561](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5561)
* external call improvements ([4f31259](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4f3125986324ef256972040671a6b76d69f78844)), closes [#5539](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5539)
* support for email for scheduled calls and attachments in desk ([a9678f6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a9678f68e13ef6bb75cdc77932eb8e5720b39ac5)), closes [#5555](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5555)


### Bug Fixes

* Feature/xyne desk v3 main ([7f74a49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7f74a492bb245522647b13c0284a2755daedbe04)), closes [#5556](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5556)
* fix for notification link not jumping to new message ([4ede779](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4ede77984ad9f33963f6e0856640ef311d8f4cb4))
* removed AgentConfigs.defaults() in summariserModel ([0709957](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0709957ae51892a4d60dee9e01189b93c2445dda)), closes [#5523](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5523)
* revert pr for internal route ([33db122](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/33db122d0a71e0360451170ea3402d3e1cc974e2)), closes [#5521](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5521) [#5512](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5512)
* show tagged participants on first modal open ([c2946d3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c2946d3703c269c24880013a7b7b97041c0e6394)), closes [#5525](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5525)
* subticket thread messages issue main ([20c0af1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/20c0af1024c5fcdfa308df4d6f667c6ce93df2aa)), closes [#5553](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5553)

## [1.129.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.128.1...v1.129.0) (2026-04-26)


### Features

* ai summary for email threads ([206b8cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/206b8cc56dafc887152274cc34a89d805e302580)), closes [#5505](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5505)
* disable send on zero disconnect ([08de63c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/08de63c6e386c25fa85ef70e23e402bbe5f1e55b)), closes [#5509](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5509)


### Bug Fixes

* added trimming logic before rendering messages ([b63bb89](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b63bb894689a2cac0a3974cc5f242026bb2aec7b)), closes [#5499](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5499)
* change center to start while navigating to message through url ([4fdcc42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4fdcc427b86137f9915d9af7a037ddd0dd02bef0)), closes [#5496](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5496)
* fixed emoji parsing regex to include boundaries ([55388a7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/55388a7a5678b71011b77d8f29dc0ec642584f54))
* Fixed z-index of toolbar items in threadpanel of attachment carousel ([a3b2408](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a3b24081869ac8935392c9c223e4697d3939b53a))
* Made vaul drawer scrollable ([898a41c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/898a41c8c439bd895a4ec3268ce52bf9e41bb0e1)), closes [#5513](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5513)
* reverted z-index for dialog box back to 50 ([7bdcf76](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7bdcf7660cfda44bbc90cbf838c735678e20c252)), closes [#5546](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5546)

## [1.128.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.128.0...v1.128.1) (2026-04-24)


### Bug Fixes

* Support-screen-queries ([f3eb183](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f3eb18380aa53b9ea00e3f1070384dd2b1f127c8)), closes [#5488](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5488)

## [1.128.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.127.0...v1.128.0) (2026-04-24)


### Features

* add xyne-ai landing page ([bfeca50](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfeca50082ee158d5f2dfd6b38e607e18d54ac55)), closes [#5331](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5331)
* adds cmd+g ([f0e19d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f0e19d60914637a9f133354989e842343435172d)), closes [#5397](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5397)
* gate Inspector behind INSPECTOR resource permissions ([76fcc51](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76fcc51f3274b89e1d0a5a52e2a64f568fa17cb8)), closes [#5374](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5374)
* reminder activity on bookmark messages ([bbf412f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bbf412fda939dbab5deae6bb149bd7b5a9fb5ed2)), closes [#5396](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5396)
* schedule call in thread main ([1073d28](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1073d286fe2eac01d89627b7c2b146f700a988c1)), closes [#5437](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5437)


### Bug Fixes

* : Notify in thread when release is completed ([4d14f9b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4d14f9b7f179fc426194b25a1f0b627d5da77000)), closes [#5395](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5395)
* add composite indices to eliminate TEMP B-TREE in zero-cache ([0e34245](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0e34245d6af5b69b525f1aa3a5466c3099f217d1)), closes [#5323](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5323)
* added a hot_words list to both google and deepgram STTs for spelling fixes. ([06d9040](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/06d9040067409e3102ee920399b9333eb858888a)), closes [#5458](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5458)
* allow all file types and add blocked extensions ([3fa1e31](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3fa1e3128fbd4f5c01bada57b57abe0f49edbf85)), closes [#5440](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5440)
* automation ticket clear filter fix ([d22f8ee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d22f8eeb4ee6c886cc6e900446abc4ac4897637d)), closes [#5456](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5456)
* calender sync call updating fix ([5ccfa74](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5ccfa74f86afafafbb12d99900ed5e03a9fb738f)), closes [#5469](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5469)
* call all major fixes ([d0fdc96](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0fdc961aa9b8c5cd6609d6e40d38c2576af980d)), closes [#5421](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5421)
* call controls 2 message button fix. ([507ca98](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/507ca9807d5bef8f76c518e922742fa2652b0a2b)), closes [#5470](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5470)
* channels/groups chat ui, attachments preview overflow ([0951a92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0951a921573c465e002bee8a9a28cdd856afb0f2)), closes [#5382](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5382)
* clear link_preview_md on soft-delete and guard UI render ([8b928a4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8b928a43bf848042bc86bb0ce2ab2cf73ed44505)), closes [#5150](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5150)
* Exclude migrated attachments in analytics ([77d5ded](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/77d5ded9580839a666c3b8a90f8cc200ddc3150e)), closes [#5398](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5398)
* expandable draft ([ddaa50b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ddaa50b653db35ba86b3920823c869104333641d)), closes [#5387](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5387)
* Exponential backoff added for bit-bucket api's ([adbfe0f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/adbfe0f8c58ad67728cefdcff10f0215cf689a59)), closes [#5483](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5483)
* filter skewed client-side latency metrics from OTel histograms ([436ad38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/436ad38e9df8a12a6dd2a5064391d23fbec344c9)), closes [#5316](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5316)
* fix custom emojis for reactions ([96a72f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96a72f5fa3a69c89ffc9d92f755587cffd67079d))
* fix link issue and soft delete attachments ([cd1d9d7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cd1d9d70a9bccde95f78af585a18ecf7cbbd32e5))
* Fix regex to allow underscores in channel names. ([3db616d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3db616dd1dd8abcf0d406ef6b7e70dbd2aea0653))
* Fix surfaceNudgesByCountRowIds query ([dbf4cb2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dbf4cb2fc79873b6d706f2a30fcdb982d918055e))
* fix visibility in create ticketModal ([c385c7c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c385c7c514473b155e8eecf4f4bb665f83509d4b))
* fixes ol marker overflow issue ([c3a0e48](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c3a0e48a211e90b7cc8727b947c6265735c39e2d))
* ios Call recordings issue ([d89a129](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d89a129bbcc927037fd81de143958d8cd7225638)), closes [#5349](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5349)
* IOS Native Screen Sharing Plugin and Native Call Controls ([dbb3005](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dbb3005b45e4092d13bcc1d4f4fb5c7236a2cedc)), closes [#5385](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5385)
* native app system and unread message ui ([57081d7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/57081d717ad8a1e020d6f3918005a0f9f5d00f4e)), closes [#5386](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5386)
* open CMDK search results in in-app browser panel ([45f20c5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/45f20c5f692b95ea15733e40c100e4f8d0e20e14)), closes [#5333](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5333)
* org workspace fixes ([a3eba24](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a3eba240d72da79058728d370cff4cdad92088f7)), closes [#5384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5384)
* profile overflow ([0f9ed8b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f9ed8b6936105231bc528af1c956f5580abf2a3)), closes [#5399](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5399)
* refactor dm and channel list ui ([6802340](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6802340a3d22837e81e2267c1c1128c7d244fa01)), closes [#5365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5365)
* reload page on IDB connection lost error (mobile) ([795cf35](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/795cf35dbc8dd39a43980f55e78c44273dd50d54)), closes [#5368](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5368)
* resolved race condition to prevent attachment upload failing on 1st try ([1ab861d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ab861d5c81fbf0a0b63d791014b8eec4ea246b7))
* scheduled call channel ([4a99e6e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a99e6ede614f54e2736d13ab3da7c27fcac9b31)), closes [#5407](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5407)
* skip loader for linked conversations already in cache ([0f8f58a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f8f58a55ab5e06012cce8fc2d7b216c0e7fb96d)), closes [#5319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5319)
* transcript post processing prompt change for Spelling Fixes. ([4a66109](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a6610928a9f8cfffeaac4327e5228ac17b02ce0)), closes [#5448](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5448)
* widening the guard on the egress completed event and checking if fileExists ([b926670](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9266704874e454d43e5facd98a43ab52ca252f9)), closes [#5373](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5373)
* worker for eta deadline queue ([70e7136](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/70e7136e73d71fb50a0d3bb2d9a027dec0d46697)), closes [#5341](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5341)
* xyne-desk-acl ([faf6e18](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/faf6e1860f6f4949ee1f64866b65a144a6203e3a)), closes [#5380](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5380)

## [1.127.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.126.0...v1.127.0) (2026-04-23)


### Features

* ask ai tools ([a0c5de7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a0c5de7b4e5b7e479696933260f58f4b1afebcd1)), closes [#5294](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5294)

## [1.126.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.125.1...v1.126.0) (2026-04-22)


### Features

* Added zoom to mobile attachment groups ([38a9301](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/38a9301132fecad0eef13702f3806f20910c858b)), closes [#5336](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5336)
* call message and bubble redesign ([d0eb27e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0eb27e531ad9e500364f43d6f068098848ab7ca)), closes [#5104](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5104)
* changes for Image Preview ([5ba0f30](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5ba0f30f297b9a3c99dff3f9d90c9b52234752bb)), closes [#5061](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5061)
* new-table-for-channel-recaps ([48c4080](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48c40803d54fbdc2622fdb4090a7a63cbc85f8dd)), closes [#5334](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5334)
* profile clickMenu ([6d5bfdb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d5bfdb676b5ac1797d7fb3cf867822e7c3245d1)), closes [#5126](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5126)


### Bug Fixes

* close action tray when clicking outside after dropdown closes ([f142953](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f142953c04d7d89e31e3450e80d09593b352de7c))
* combined fixes for claw ([c0481af](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0481aff46c31b97ad24da679c2b4692512abea1))
* editing description for channels ([307bd95](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/307bd950579fc04660d6d7dfdba1a71b0eb03849)), closes [#4726](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4726)
* Feature/xyne desk ([1f9aad3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1f9aad384ebd20d1903932ff7b513cd05dbd8464)), closes [#5343](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5343) [#5299](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5299) [#5295](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5295) [#5047](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5047) [#5229](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5229)
* fix CMD+K search breaking after @ backspace ([f329f6b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f329f6be652a4dd5d89026ef3f5dd3dcde9f9ceb))
* fixed refresh token issue in native app ([c9409ef](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c9409ef0fd8a389fe00c1816c0528c805cfc946a))
* internal link fail issue ([f8f616e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f8f616ea338a4140cb3266ead460b3e9742d1d05)), closes [#5342](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5342)
* Recording name when stopping from other place ([8dc2a72](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8dc2a723ddd1b341f4cb1b1580145e64e9b6e7fc)), closes [#5280](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5280)

## [1.125.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.125.0...v1.125.1) (2026-04-22)


### Bug Fixes

* draft ai fix ([42c7ce8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/42c7ce81f9a05a0f717d07a0e8a6cd0cf3364d97)), closes [#5339](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5339)
* support-screen-fixes ([0ec7f9e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0ec7f9e6dcde34a4bd9b5dbe1fc5e005e61a27a6)), closes [#5332](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5332)

## [1.125.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.124.0...v1.125.0) (2026-04-21)


### Features

* Add autofocus to DMS search on page ([d705699](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d705699ea6f34f44b63b790d0d54c8117c3e4e78)), closes [#5302](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5302)
* add slack-style emoji autocomplete in chat input ([6a029cd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6a029cd3923d8920b3d8aa709ffca05915d64360)), closes [#4978](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4978)
* allow external people to join calls ([c0986f4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0986f495b7ae85322fea4c540b4792113378c69)), closes [#5329](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5329) [#5320](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5320) [#5309](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5309) [#5232](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5232)
* Create call by dragging in calendar ([a2f3a66](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a2f3a66f00c5252ec2c40d061837fb1972a10dcf)), closes [#5268](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5268)
* org and workspace ([ed475a4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ed475a4099adbf0c7aa42adca1c6ff4192315d7b)), closes [#4473](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4473)


### Bug Fixes

* changed the app.json as per current xyne spaces app ([bd8118a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bd8118a7109b5cb7862e5fa499abc5db1ef28999)), closes [#5271](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5271)
* Fix channel search input focus not moving ([810c1ac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/810c1ac425ff71410847a82926a46c75790ecee5))
* fix UI of GroupDM Avatar ([8ec57a5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ec57a55cbcf2033d05398d92394865d6e9a537b))
* fixes mobile dropdown back button issue ([a04eb6d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a04eb6d9c9dafb9c93ccfc81bd7b8ba4cb49a5d3))
* fixes ticket card overflow issue in kanban ([99f3f91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/99f3f912293a014f79dffb88b0f70b6e29b840aa))
* fixing hardcoded things in PR-4473 ([1a4278e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a4278ec7a75403822307b4bc4bfe8629213fc67))
* native app ui bugs ([b256458](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2564581dc6c8a824b5ee57357cfd7339bbdc647)), closes [#5135](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5135)
* protected route redirecting to chat on refresh ([bc0e865](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc0e8652571a5bb469af7fa7297185a364e0f7c7)), closes [#5262](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5262)
* screen picker modal not showing ([c3bc6cd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c3bc6cd7e89406612577ece24faa0fbc750ecbdb)), closes [#5308](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5308)

## [1.124.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.123.0...v1.124.0) (2026-04-21)


### Features

* Redis job to multiple workers ([4074bfd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4074bfd050ce3a15b5c28df30b916e92feea960f)), closes [#5194](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5194)

## [1.123.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.122.0...v1.123.0) (2026-04-21)


### Features

* Implement default mute when more than 5 participants in call ([5918174](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5918174af6afeb02c9ae3e0813a0b26e90df9695)), closes [#5275](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5275)
* rename channel ([063917f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/063917f4b03871820284008785dfbdc1d86e2d43)), closes [#5234](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5234)

## [1.122.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.121.1...v1.122.0) (2026-04-20)


### Features

* added filters ([931cacc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/931caccd27a270ca3898f2c6aa09221b4d4923bd)), closes [#5237](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5237)
* airborne fcm in lotus and xyne spaces for android ([9f1acc0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9f1acc06bae4a5a865a740cbbe59b07216d24bb1)), closes [#5193](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5193)
* display last 2 avatars for group DM messages in sidebar ([3aa1fe4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3aa1fe435a750401360c159b5901e23255a4a240)), closes [#5127](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5127)
* Drap and Drop to reschedule calls ([384a381](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/384a381f21b9a405f9b8322e9ac5419485ee0a7c)), closes [#4945](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4945)
* egress recordings for calls and recordings. ([d321e92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d321e9200c359b8b05472c59fd37ceef44b669bf)), closes [#5201](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5201)
* Enable image copy paste ([c07f33d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c07f33d8311a3c35f1c1b9a7d6d2a42759a10647)), closes [#5103](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5103)
* filters in dasboard for scheduled messages . ([6298b3e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6298b3e248ff3e3303c7d596b422f30865cf0795)), closes [#5248](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5248)
* fix unknown channel issue ([d39d535](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d39d535ea4d8d15328045b9767492f8829623f31))
* native app chat date pill sticky, ui refactor ([860e384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/860e38433a950014da23ec4b17e432c649c375f3)), closes [#5242](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5242)
* pre-populate thread participants when opening huddle from thread ([7301ff1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7301ff15551e285b57776f1f7d2664efc61b3585)), closes [#5261](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5261)
* speaker diarization in calls ([5f81db0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5f81db00925fbbdfd24bcd7ab86d4e4f72e4e9a0)), closes [#5027](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5027)


### Bug Fixes

* [Mobile] Autofocus input after mobile attachment upload ([766bfdf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/766bfdf719b47a97580805783bfe5b1d2d0e2bc4)), closes [#5036](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5036)
* add darkmode fixes ([ec7fdd8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ec7fdd866da7a1a70ed03665df4d0cd080ff3c61)), closes [#5270](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5270)
* Added composeDmPanel to DmsPage search and new conversation list ([ec1dcc9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ec1dcc95786ce9575ad03bd5f5c7967e63d994ed)), closes [#4708](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4708)
* ai onboarding blur overlay gets stuck and blocks UI ([2c00ac7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2c00ac732bf3e8a11dcbba0c9251b0efbbb3f5a4)), closes [#5047](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5047)
* analytics fix external channels ([bf93cbb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bf93cbbd13f0b39e5492ad79aadb8b48d601bcb5))
* android always load bundled package ([8d4d25a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8d4d25acdae35b41f3160033c078723c4c43d0d9)), closes [#5174](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5174)
* change set number to array ([95ae1a5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95ae1a51e7fee95f53db9892ce9bab364acdf45e)), closes [#5141](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5141)
* fcm silent updtes for iOS ([12ed51f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/12ed51f3fd44a6b07feb06985da65249cdb69c47)), closes [#5263](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5263)
* fix no attachment to load ([176a253](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/176a2538fd0661992ae3a477c26621223302d2e5))
* fix the link formatting behaviour in tiptap editor ([90db7be](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/90db7beaf2413dd47720a859c15bf6afb2f61b46))
* fixed custom emoji not showing on electron ([7657a89](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7657a890803e7bdd4370d8e79784b0ad2990f339))
* reaction message delete fix ([c64fd45](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c64fd451b69653587f0c64ddcdae7d5bee0239e9)), closes [#5154](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5154)
* removed showing status in group dms ([275c8dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/275c8dc84d655767a7ec46f102a31b213bc23621)), closes [#5250](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5250)

## [1.121.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.121.0...v1.121.1) (2026-04-20)


### Bug Fixes

* errro handling in ui ([a50e825](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a50e825af56868c02335e43b2611ffd01446aa13)), closes [#5241](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5241)

## [1.121.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.120.0...v1.121.0) (2026-04-19)


### Features

* added polling for google and microsoft calendar data ([1debd94](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1debd94decfd0a4be23f46e7c6969a553f75c8b3)), closes [#5202](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5202)

## [1.120.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.119.0...v1.120.0) (2026-04-18)


### Features

* persistent floating recording pill for meeting detection ([446a756](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/446a7562ee402647ce7a5cc86f5aa8105a03d490)), closes [#4656](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4656)


### Bug Fixes

* add w-full to code and text file viewer wrapperClass to fix squished JSON view width ([c1bd18d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1bd18d1cc4e389fee16a8e5aa57e3567d88ebf0))
* fix the collapse when clicking the backward and forward button in top bar ([0832ebd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0832ebd1fb31bf1022b3ef9f21868a2e04d2499b))
* Fix thread expansion CSS breakpoint issue on side layout ([09eb6e6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/09eb6e673e8604c42df9c15afb63fbbecaa5dbb7))
* Minor improvements for generic storage ([8c3667c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c3667cece6acf2e904bbfbc6f377fc5d471de1c)), closes [#5199](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5199)
* removed quartoDocModal unused code unused query ([6525b80](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6525b8025d082213b48c5127dee988769ae4f520)), closes [#5132](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5132)

## [1.119.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.118.1...v1.119.0) (2026-04-18)


### Features

* show tombstone card when message attachment is soft-deleted ([593ec32](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/593ec32e647a0dc0488e7a68874864455789562a)), closes [#4760](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4760)

## [1.118.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.118.0...v1.118.1) (2026-04-18)


### Bug Fixes

* skip automation and enable docker push for workflows-only changes ([e44184e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e44184e9745ef4cc61c39e3a537371a0fe5b8a88)), closes [#5190](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5190)

## [1.118.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.117.1...v1.118.0) (2026-04-17)


### Features

* (cmd + K size increase by 1 px) ([aa483a1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aa483a1b3dd446c9f4239991323e73561550b360)), closes [#5148](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5148)
* Add profile link to user chat name ([ddf7555](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ddf7555b9f4ad87ccea15cc1fbceab25735dee3f)), closes [#5137](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5137)
* added retry logic in native ([b68c08e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b68c08eb4b90248b7e84787ae289987519caa339)), closes [#5124](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5124)
* bit-bot integration for pr-check for euler-repos ([b537e93](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b537e93b6fecf072557db6d170d5b110e88f80fa)), closes [#4885](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4885)
* Custom Recap ([93e6185](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/93e61854f6c59bf15c7e360ad61ea9038dbdd908)), closes [#4749](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4749)
* fix user groups update and menu in kanbanscreen ([a5c3cf0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5c3cf0ca8cd9dfc4f614383aa5156e34eda4448))
* log only initial zero query completion ([18247e3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/18247e346e48d2d272318ff54cd0bd5f628a5f57)), closes [#5163](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5163)
* Make message URLs clickable in sidebar ([7860361](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7860361468a5392b754072547f07e59ee963152a)), closes [#5088](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5088)
* Native call functionality for the Lotus mobile app ([e7a31d4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e7a31d44e809a16a24fb4b9301c23b188e142b36)), closes [#4629](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4629)
* revert - add Rename option to channel Info modal" ([aaa2e32](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aaa2e3211d1936cd64b3d7d9ae0f9e01d42f845d)), closes [#5196](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5196) [#4913](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4913)


### Bug Fixes

* add darkmode fixes ([eac03fa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eac03fac6065546409c54083eba1f13c136260b5)), closes [#5187](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5187)
* added a gate for the audio connection sync b/w callkit and livekit. ([6101e42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6101e4274cd15a1f493248c6b9fdbd6a23cdd67d)), closes [#5090](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5090)
* emoji fix ([b2184f2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2184f249d90da794693ed7d0f2d694b9228b3ca)), closes [#4999](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4999)
* fix input box placeholder and icon size of ticket activity messages ([ba58591](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ba585913e27761f01b5e2a29e68ed0e37c7b6039))
* fixed one tap issue ([cff79ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cff79ff9c61f3417d30e353a27d4c190f7883f8f))
* fixes bullet ol list num overflowing ([25ed3fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/25ed3fbc6abb7da4e8fbf33263a8aaadf801557b))
* iOS Airborne release integration redone ([7f9453b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7f9453be7922f0e0e4478b30a207008130c050d6)), closes [#5069](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5069)
* Make selected channel editable for call summary ([8304bef](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8304bef3882e65dc26ec7928de4e156633172efa)), closes [#5168](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5168)
* open attachment viewer when clicking anywhere on file row in files tab ([a4248a5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a4248a56e38d6f56636d7166fd0cfdb3d6820231)), closes [#5028](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5028)
* remove satgeChanging ([0515901](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0515901243e75992f9d46ddc4847eb62fabb6a29)), closes [#5173](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5173)

## [1.117.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.117.0...v1.117.1) (2026-04-17)


### Bug Fixes

* remove delete cookie on app-quit ([cff5f6a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cff5f6af0562c98744b61a7771c80ded34df6caa)), closes [#5046](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5046)

## [1.117.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.116.0...v1.117.0) (2026-04-17)


### Features

* add generic storage interface for s3 and gcs and support microsoft login from devices ([1fb56c9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1fb56c9518743ab438ca5f562db0f97b2ff75277)), closes [#5056](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5056)
* Added batching capability for vespa calls, connection pooling & backpressure ([5b036e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b036e458feebf4e1caf4286193eb80a276e5479)), closes [#5119](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5119)
* adding-logs-in-messaging-and-attachments ([09ab2fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/09ab2fe6d04d3f55791a6c12b497a6053abbcc42)), closes [#5110](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5110)
* enable OTEL metrics for zero-cache and remove redundant backend scrape target ([77b7791](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/77b7791268933b33c61779b8428aa067ad042889)), closes [#5123](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5123)
* Send call summary to a channel ([b2fdb2e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2fdb2e9eacf7f1e05dc9f05ea2ac29c5c7d00ca)), closes [#5043](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5043)
* Show user status ([4acb55c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4acb55c1c0da7817fad3a42ee02d419c9d63c829)), closes [#4957](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4957)


### Bug Fixes

* add og image handling for real-time link unfurling in chat list ([b586153](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b586153cda1e19955fa8bb3862b17ce490ea2de7)), closes [#5041](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5041)
* copy width/height when forwarding messages with image attachments ([dd4c408](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd4c4081e83364bca474eeb1b49ca6c86cad42b6)), closes [#5082](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5082)
* date range analytics. ([5c298b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5c298b94f75ad06039e03e4acdf50480b4f3a31a)), closes [#5111](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5111)
* electron JS fix and new tab shortcut fix ([bee9211](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bee921133fcbc179b48626324cb98ab236ec052d))
* fixes bullet ol list num overflowing ([369a5d9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/369a5d99a2a417bc4422c3151485c63010c11875))
* Integrity workflow ([e9bbdd4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e9bbdd462f20199efaa06ef8f866aeb6f382f475)), closes [#4951](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4951)
* lotus shared imports ([4a85062](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a850623b95d35dca7f7ee26fdf4eaea0d78b457)), closes [#5129](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5129)
* message send bug fix ([4a446d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a446d660d704565f890e6d5aa1bfea008733454)), closes [#5016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5016)
* prevent mid-word line breaks in channel messages ([0c48ce6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c48ce6510abf6f6c23c521fe7144f27054b42b0)), closes [#5007](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5007)
* Remove create ticket option from thread input drop-up ([41cc553](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/41cc55394eac96ed4ce46c5298c4d952181f39f1)), closes [#5075](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5075)
* resolve Bitbucket PR link previews with URL-derived fallback instead of login page ([91ad2ba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/91ad2bad578ea1bfd0b14cc9134d510782f056db))
* sanitize filenames with special characters during upload ([8ef57ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ef57edcbada9da4dce4b4abcce6037420477533)), closes [#5081](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5081)
* Xyne Apps New Channel Routes ([bc8bd92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc8bd921f6a6d487850c996e2c527274b48131c0)), closes [#5130](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5130)

## [1.116.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.115.2...v1.116.0) (2026-04-16)


### Features

* add Inspector tool with Grafana log querying support ([27ac10c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/27ac10c84cf544a39d11c041887a2a63a55a43de)), closes [#5022](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5022)
* add Rename option to channel Info modal ([faf6e7b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/faf6e7b28fdf5188941e5fcbb1cfdff9fc8531f4)), closes [#4913](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4913)
* agent control state fix ([0114b7c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0114b7c87a53bba874d01fbe3c9917b0858e92dc)), closes [#5067](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5067)
* ask ai memory v2 ([f659d71](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f659d71baeba1b6665aa45500692e6d100769c08)), closes [#4825](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4825)
* changes to fix duplicate react via share ([37a6d9f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/37a6d9f64c6e13febfaa11345eabf61fa54be79d))
* convert ASCII text emoticons to emoji in chat input ([1c59bd5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c59bd5443a74eca1ccb2053ee079f14d927225b)), closes [#4937](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4937)
* message_scheduling ([8a3ce52](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8a3ce520c8c0621825b7f672d207b0f59437ba48)), closes [#5040](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5040)
* native app simple channel search ([0f4a2d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f4a2d6c3da90c293a828fd3261df1b23cd1efd8)), closes [#5089](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5089)
* revert activity changes for caching paginated queries ([57d351f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/57d351ff0e5fa3635daf68ee350b9333193bcb81)), closes [#5062](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5062)
* Update user status to 'in a call' during active calls ([f4aa3ab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f4aa3ab9ab1272935a5931a00a3f8a561173a590)), closes [#4365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4365)
* use Sudoquery for search metric tracking ([8f04f2b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8f04f2b4eefcf0a8713e8b7cf35fbea81a5afc14)), closes [#4972](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4972)


### Bug Fixes

* active call bug ([b223d53](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b223d5320aaa136e0f6940cfd309d2d28d3d9ce4)), closes [#5064](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5064)
* add darkmode fixes ([5e7192a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5e7192a2c062c4b9de1c518119c2dae433e27096)), closes [#4998](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4998)
* add isMember arg to backend conversation queries ([e256dfd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e256dfd17d94158a5e3833f5ff0217d5ae64378a)), closes [#5107](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5107)
* added splash screen. ([d7b056a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d7b056a33d2941bba3a8e83ac43bcb0b02f3b99a)), closes [#5053](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5053)
* dashboard workflow changes 2 ([f343bb3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f343bb3681dc1d5c762bc16f34289a372534df13)), closes [#5042](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5042)
* dedeuping deps in the shared folder ([751e8e7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/751e8e7fe6a26226c82e97b9958ccd2bb94f1fd1)), closes [#5071](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5071)
* fix disappearing 3-dot menu in group view ([82d1f13](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/82d1f135508817e6b1bd469085f3dacfb4531d10))
* fix file processor for unicode replacement character. ([0aacec6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0aacec6a92656f402a8db4019197b22b16f4fe6d))
* fix message analytic ([f9c291d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9c291ddc413d470b753cfc14e9f3f6bbd5aafb1))
* Fix yellow color on user tags/group mentions ([4211107](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/42111070e2eedb8c59285d893fc182e6b9c17ffc))
* groups channel header buttons ([f281df4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f281df4c9d0df2f7d972cfd2cefe98077a06eafc)), closes [#4775](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4775)
* Migration Fix ([a61f0e5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a61f0e5f72072a4a32ecb7473060a563a62ccce9)), closes [#5094](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5094)
* minor runtime error fix ([d6b7430](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d6b7430208e2c0429c5c3a89e7672c55a9a70520)), closes [#5108](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5108)
* Revert common component to render the virtualised lists ([86bf84e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/86bf84e3eddf51815631dbe41308952874d036f4)), closes [#5033](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5033) [#4609](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4609)
* scalar acl conversations ([0073700](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/00737002a5001dc73dfe5bec16b7aa58c3a26c88)), closes [#5045](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5045)
* xyne apps route fix ([8e80d74](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8e80d74a683b0a8069854956a12156663e536293)), closes [#5098](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5098)

## [1.115.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.115.1...v1.115.2) (2026-04-15)


### Bug Fixes

* Cmd K UX improvements - error, channel, user search ([d5f1930](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d5f1930e312a3bc67ffcfeb848fb2ce803dd2b8d)), closes [#4936](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4936)

## [1.115.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.115.0...v1.115.1) (2026-04-14)


### Bug Fixes

* add label addition/removal to ticket audit trail ([5f1952b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5f1952bd2df3687faca7e790dbf4bd0956e48df6)), closes [#4984](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4984)

## [1.115.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.114.0...v1.115.0) (2026-04-14)


### Features

* Add unread DM counter to Direct Messages sidebar section header ([bb09c5b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bb09c5b5e754c853d611f5b2b7805d6642578d8e)), closes [#4954](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4954)
* Edit feature for calls from calendar view ([9539933](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95399332be488c6e1061ea1417341862a1cf6d1a)), closes [#4898](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4898)
* Extend Manager/Team Lead control config ([e227b08](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e227b084eecdb6e6ece3e105885cce25916face1)), closes [#4946](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4946)
* status-mapping ([9638105](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96381056202bd0e74cc06e37358afa00f2221425)), closes [#4989](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4989)


### Bug Fixes

* add group Dm in phone ([b993c7b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b993c7b1f45b1a1a832bcf33ab57e50e551ccb34)), closes [#5009](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5009)
* added context on PR workflow ([e81a599](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e81a599611c0e6a1e8a6659d24d7351123227b1a)), closes [#5018](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5018)
* added shortcuts fixed reload and fixed new tab issue ([151734e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/151734e90d7924032cd74d0f69bab533cbb738e4))
* Allow nullish system fingerprint in litellm provider ([aeedde4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aeedde4858b65711804650dfaab1ab2602b00b94)), closes [#4869](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4869)
* Bot Migration Fix ([2d131e3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2d131e398d03c8e560f100d849f79c0340751f5b)), closes [#5038](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5038)
* Channel/DM navigation from chat list, system messages UI, and DM list improvement ([207c021](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/207c0213870827267c750e5e22bef726d647f07a)), closes [#4917](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4917)
* fixes ul and ol bullets nesting ([e2169fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2169fdc16496296abe403be078b5ffb274b1b98))
* have last visited channel in activity back button ([4105679](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/41056791edb0426c679a613d6fefc2226265162e)), closes [#5021](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/5021)
* made the activity tab and its cards as per the figma designs ([a5ec086](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5ec0864ff392763fdb0a62f3a41c64616d15b95)), closes [#4922](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4922)
* moving common frontend code to shared ([0853cbc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0853cbceb87ea4f7b45c88237b65dea2bd40acde)), closes [#4567](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4567)
* native app chat dark theme ([2eca731](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2eca73164b6b15c343ad9fdeadc0d1cdd6e8b5e3)), closes [#4974](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4974)
* New LiteLLM Key for ASK AI ([e09c0ab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e09c0abcb7db12c1bfa46615d623581b31d6bb0b)), closes [#4929](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4929)
* overlappings date chips UIs ([f793367](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f7933671282aaa9b2ed7a3c3b940f946be886e34)), closes [#4942](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4942)
* user group mutator fix ([e6781ba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e6781babc3dfe035e945990ee0bf80a1214076a9)), closes [#4996](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4996)
* xyne apps duplicate ticket ([9eaf10b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9eaf10bb0b2e8b6ce3abbc57b6f06f8aaf5f95a9)), closes [#4994](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4994)
* XYNE-12274 XYNE-12262  added one tap spell cehck ([7670b65](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7670b65ca78ad8be1aadffeda310834631816d93)), closes [#4973](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4973)

## [1.114.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.113.0...v1.114.0) (2026-04-13)


### Features

* Display user active status ([fb7063c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fb7063c4a2c9b05ffababf11c507b8f6b850b1a2)), closes [#4982](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4982)

## [1.113.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.112.0...v1.113.0) (2026-04-13)


### Features

* Fix .pem file upload failure in thread ([1cc6ddd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1cc6ddd4a64052a7734bd329509016e5a4b47af8))
* indicate download attachment in electron ([674a321](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/674a321dfa96b97e19a219b07019ad2197c52b45)), closes [#4927](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4927)
* Optimize user and channel queries ([6920b4e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6920b4eb9f75143aa7515e7dd75e25007d78c84e)), closes [#4904](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4904)


### Bug Fixes

* can remove from public also ([934bc47](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/934bc47cbf723828dab9f53904d65ea3361df88a)), closes [#4965](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4965)
* channel-participant acl fix for dms ([aed3976](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aed3976baf9e47b5da80450fb99bd777fcbdf75b))
* Cmd+F opens Cmd+K with in: filter for current channel/DM ([410cfeb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/410cfebcd068052162d36385f371af1ba35b7406)), closes [#4872](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4872)
* creator can leave channel ([2b588d3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b588d35634908ebac82a78b9ef02f3e3fed4626)), closes [#4943](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4943)
* disabled the review step when triggering through pr ([e2c6f30](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2c6f30e763d82d23a6cb29984ae5b911a2ee952)), closes [#4847](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4847)
* fix mobile header padding in activity section ([c17c7c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c17c7c2d070361e21c943a2a73420f85e555c6d2))
* fix timezone bug in recurring call series ([9725fa8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9725fa885f1b20bb0564d228f99ec0bd4459d378))
* Fixed isInGrid UI for grouped attachments ([8d8babc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8d8babceab13a1f074054e32cf4feef40ace27de))
* ra on description ([1c3bd48](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c3bd4836415179d8eaac0bb1b211520b6fee814)), closes [#4886](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4886)
* wrap long channel descriptions in Browse Channels UI ([98812f1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/98812f1113fad2797e68851fc12556ee80e187d6)), closes [#4914](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4914)

## [1.112.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.111.0...v1.112.0) (2026-04-13)


### Features

* add pre-commit hook for enforcing migration file changes presence when schema changed ([16ca7a3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/16ca7a33daf81eca3a6aa05ac534dcd4b8f2073e)), closes [#4764](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4764)
* Add UPI Analytics bot and update related configuration ([0a765c0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0a765c006772b544695e87f2c5d8c1ef7a7e81f9)), closes [#4822](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4822)
* Add vespa metrics and vespa queue metrics ([d3499b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d3499b91d7986bf50279c895edbb065dbff4e7f6)), closes [#4815](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4815)
* added caching logic for paginated queries and applied it for activities ([7597bf3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7597bf3c6bc2e90d3719541f1fe5a0215ef1b4a1)), closes [#4777](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4777)
* adding dedicated litellm key ([7f785ce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7f785ce6215d5318b951e8b858749ebc504db545)), closes [#4819](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4819)
* adding env for the button's visibility ([6a66b8c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6a66b8c37360c6291ab1f2762c20e2e79b6afa7e)), closes [#4867](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4867)
* changes for ios notification and /register fix ([211eff2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/211eff21a442541302f3d35ea155a36094737da9)), closes [#4826](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4826)
* Clustering tickets using PCA= ([6c7b050](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6c7b050577e897af382448edeefe3850ce78961b)), closes [#4015](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4015)
* corrected prisma file ([4c7b785](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c7b7853e64a209a04ffc5bf0e213b680c2695ca)), closes [#4831](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4831)
* custom screen share picker ([9e1f8a1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9e1f8a16b8acf086184df6f41e52b5d6b6328d97)), closes [#4808](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4808)
* Display user active status ([bce28f2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bce28f28ff0fb35da115bfd0acd746a9dcd1ec1c)), closes [#4838](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4838)
* fix thread header color tokens and routing gesture consistency ([a4ac549](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a4ac549760933e5044fa4416f700ed1de3e0ca43))
* full role auto assign in user Groups ([fe33372](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fe33372fd6ec1a90a03b501522a20107cd8d644f)), closes [#4750](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4750)
* Implement user email signatures and database storage ([1194e51](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1194e5154aa78d7578f12153eb525881827192e2)), closes [#3970](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3970)
* making a common component to render the virtualised lists ([0ed400e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0ed400e295469b621ffd89341dc817ee49478d02)), closes [#4609](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4609)
* native app edit message action ([d33d83e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d33d83e557942de7ce989dec815a9add3648942b)), closes [#4804](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4804)
* New UI for Call Calendar participants list ([ab0d80a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ab0d80ae3452799fb07900fb2218bf9fd15792ae)), closes [#4848](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4848)
* Prevent duplicate Slack notifications in Spaces ([5e42bcc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5e42bcc30e42afc8ef25b40114d2c81948e5cbc0)), closes [#4837](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4837)
* Removed pre-execute check ([df92903](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/df92903d1ff00bed48b67bbc06fc0027b40203c6)), closes [#4747](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4747)
* seperate env for litellm calls ([afffa08](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/afffa08f6865271ba7a353dc248ed0e0da037653)), closes [#4828](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4828)
* Support for all bots migration ([d148044](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d148044337c8f17e8e8fbe8930b4416282f883d3)), closes [#4800](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4800)
* unfurl xynepsaces url ([2746016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/274601605e344e194026cfa81bb9a2265a1581d9)), closes [#4846](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4846)
* xyne apps screen ([2b11e54](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b11e54006bdcda773a28ec00d44ab94841b2815)), closes [#4755](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4755)


### Bug Fixes

* : resolved horizontal scroll fix i command menu ([cba86aa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cba86aa11a025e722687cdefd574322a8a893e2b))
* Add Config based file indexing ([f6dee4e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f6dee4e00b4a4cd8aa9ae565d062c045f7277ef9)), closes [#4832](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4832)
* Add show all calls in my channel toggle ([72e2d17](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/72e2d17af5753d0c328ebb207062c5acfdc4168c)), closes [#4809](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4809)
* added enabled to getAllRepos query ([72e8c4f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/72e8c4f18b1a4127318940fe32842ee47c929e89)), closes [#4821](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4821)
* Added middleware for message and conversations updates ([723f6e7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/723f6e73f462606a492e10fd38dfb7e12bc85a0e)), closes [#4865](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4865)
* Auto-open add people dialog on channel creation ([758716b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/758716bec048620905631dc24d808e38eebee0ec)), closes [#4759](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4759)
* Direct call navigation on cold start from notification and call iniate handler ([33d44da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/33d44dae1217ddff9a7f036e8ba17ee2dc4151f8)), closes [#4852](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4852)
* fix conversation message position when opening its thread message ([f1aa22b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f1aa22bce9c56deff12029bdead4f7fd8d0fcb44))
* Fix sendToChannel message updates ([157ebb3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/157ebb34b65103ae581042c544115da6a1ceb4ea))
* fixed native app dm chat ui issues ([53953a7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/53953a7250a006738a081ab74705e06cad8c30e0))
* mention yourself in canvas ([7e98cf9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e98cf97361f400b422bb794c223c8653454fa2b)), closes [#4879](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4879)
* Migration Fix ([12fd480](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/12fd480fb45a080bb2e65d9560c2777b2c018745)), closes [#4930](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4930)
* Migration Fix ([f06b4c3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f06b4c3265384f73fe2adc509ae3e24f2b327996)), closes [#4890](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4890)
* moving-to-env ([f47b1bd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f47b1bd7db7b4f99ef588bfe0a017aded13c398a)), closes [#4888](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4888)
* native app chat ui refactor ([c8e1bda](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c8e1bda5fb69d18acd1087e7fe073885af995c4f)), closes [#4880](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4880)
* Open profile instead of DM for tagged users web and mobile ([5d77b62](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d77b621bd472d1647e1c8e3da1ff443e0a9e651)), closes [#4142](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4142)
* order users in CMD+N by conversation history ([56b4e18](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/56b4e18c840823123d968b0dabd8c894aa103e9f)), closes [#4779](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4779)
* read replica for analytics ([692ee67](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/692ee67360b3e35fbb5e808376e68e6dff9d78c9)), closes [#4883](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4883)
* removing the intermidently failing changes temporarily ([93a1b79](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/93a1b79cf9ad11afea0fa5a8dacddef1254ee974)), closes [#4928](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4928)
* replaced new application with old one ([e7fa67e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e7fa67ed1b8ca491030b5c00262ae9bb9a883ddf)), closes [#4881](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4881)
* revert optimise frontend channel loadingg ([6b48bfe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6b48bfef4fef57512a4d37547a428184ff42c875)), closes [#4769](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4769)
* search ux improvement ([b161ec2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b161ec2f967918b8916e1880b74511c60c3cba03)), closes [#4810](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4810)
* show notification after workflow completion ([c8c7a9c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c8c7a9c84d508449ba27cfb4d55aa98ff02a18fa)), closes [#3647](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3647)
* workflow poller fix ([4cbcd6a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4cbcd6a4f9da443d60d3560c1768529c97b4fcc7)), closes [#4827](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4827)
* xyne apps board check ([4b000b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b000b046ea15fbe1db8ad83b10141862263f1ed)), closes [#4906](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4906)
* Xyne Apps Bug ([083180e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/083180e262347c4a020bbfb93860d11485b2b043)), closes [#4866](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4866)

## [1.111.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.110.0...v1.111.0) (2026-04-08)


### Features

* : resolved z-index fix ([c7278cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c7278cc7beb202c952b572b5f2000e25b8a7ab6a))
* Call organiser should accept the invite by default ([b4a812c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b4a812c36cf26d7e9aa707dcb8cc7d83e2964b35)), closes [#4784](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4784)
* fix unknown channel issue ([ebf3426](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebf3426ad7c32dbe78a08115f05a38aa05610eaa))
* made console logs conditional in client logger ([5ea7a76](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5ea7a76ca99ac37526e53a0b76158322900f2d69)), closes [#4768](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4768)
* removed null constraint for updatedAt ([466b629](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/466b629f7d5e0284adf5be8627b92d1bed791333)), closes [#4751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4751)
* send notification when added to group/channel ([232fbd5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/232fbd54f5d0166c4c6a85aa1cfeef3ee2ee15c3)), closes [#4668](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4668)


### Bug Fixes

* added airborne integration ([2b58a75](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b58a7540faccadb438d9a8a0da2187273d0435e)), closes [#4739](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4739)
* change route preview ([a3b3e55](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a3b3e55d4f62e10ac64e9c710baf415b90f4fe9d)), closes [#4767](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4767)
* fixed mention trigger to detect hyphen ([2038abd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2038abd9ab21c72902553d83959a51efc19ee09d))
* fixed message and activities issue, added new pagination pattern in single dm messages ([e3192f0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e3192f00322ac3682de7c418bf0c5d76673ef4b8))
* fixes ticket creation attachment issue ([af9ed76](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af9ed76d6e7dc2902646db44a5d9c5a2b68eff48))
* ordering change from:/in: operators in Cmd K ([b012d92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b012d9282c3a05ca2bbac9a61bbc5c3ddc0ea0fb)), closes [#4640](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4640)
* support workflow refactor ([c1a39da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1a39da2d2919ab612c57718ba48076a2d7a6b70)), closes [#4631](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4631)
* XYNE-11943 Fixed Image attachment thumbnail ([c1db880](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1db8808133b70948dc4b0772c6babe0de2b42f0))

## [1.110.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.109.0...v1.110.0) (2026-04-08)


### Features

* Add support for linux build ([6864a29](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6864a294fe32c2b202c11fc7ee1124898afa5772)), closes [#4447](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4447)
* add unassign button to assignment dropdown ([709dea7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/709dea7b29dccfca982f837c609ca084d0c73536)), closes [#4714](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4714)
* add user level skill to ask ai ([2dfdcb9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2dfdcb9d5164b49f275ec206b3af49065e62f808)), closes [#4663](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4663)
* auto fade annotation ([193b93b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/193b93b81810f62e020fa7b114c55f08876cf994)), closes [#4720](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4720)
* Calendar View for call ([dd71088](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd710884a8fbab1c702f02ac2779275955b23f6c)), closes [#4691](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4691)
* initial walkthrough set up ([fa955f5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fa955f556c0fa85e62216030c636962980147cda)), closes [#4692](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4692)
* upload document in vespa memory ([dc39be6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc39be656e9f81e76a3975d4365865156aeaf2c5)), closes [#4728](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4728)
* use reactions in calls ([be619d9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be619d9b50c6c66c5f8016fd96af09aa4f07ae67)), closes [#4599](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4599)


### Bug Fixes

* Add Message Metadate backfill api to migration endpoint ([7b32580](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7b325803f0b5e87948fa822e2926a0c48ed62e40)), closes [#4743](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4743)
* add mimetype check ([d8f2cf5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d8f2cf5925fb84cf58d90333398412b78d06fa38)), closes [#4733](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4733)
* added activities-loader-join-fix ([1aa218c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1aa218c55aaf419df87c40d490e046192d9b084e)), closes [#4745](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4745)
* added auth route for ticket ([4657299](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/46572990f5a37f806cf049980ef93337d46e7e45)), closes [#4740](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4740)
* analytics bugs ([0bacb92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0bacb92ea6bd42072de0f7e388ed3534487fef32)), closes [#4684](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4684)
* dark mode - analytics ([864f202](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/864f202381af12d66e93c4eb3c9deeebb28cd505)), closes [#4569](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4569)
* Distinguish public vs private channel icons ([6e8617c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6e8617c7769cecd8d09b4c098323a6c861909954)), closes [#4713](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4713)
* Fix send to channel ([f063238](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f063238d489b81c6fa3869b7c848e95f90c41d6c))
* fixes copy-paste mention tags issue ([9abd35a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9abd35a08f693d95dfb2dc33541240e35e5652fb))
* fixes edit option on ticket msg text ([0a33930](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0a339304df341209838dbc4254b6152dd1755d1b))
* meeting popup Dock icon disappearing and window chrome stripping on macOS ([49a7403](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/49a7403e367a3b47a15fc3b86901ca8ce49f215d)), closes [#4653](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4653)
* update environment variable handling for summarizer model ([d9395b1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d9395b16507dea702cfa6e4c96e555180e9a1c6b)), closes [#4752](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4752)
* Xyne Apps Bug ([d377524](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d3775240f9018ce888dae340885c804e5de11d09)), closes [#4694](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4694)

## [1.109.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.108.0...v1.109.0) (2026-04-07)


### Features

* clear DM search on selection and add clear button ([349c857](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/349c8573a22f15aca2fabed53de7e11bc392dc0a)), closes [#4644](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4644)

## [1.108.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.107.0...v1.108.0) (2026-04-06)


### Features

* Xyne Claw ([73ac8ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/73ac8ed6fae08dabc5b24db736ed315151980d5b)), closes [#4633](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4633)

## [1.107.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.106.1...v1.107.0) (2026-04-06)


### Features

* | Version Bump Workflow - added support for multiple dependencies, slack notifications on completion ([dcb9dd0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dcb9dd0ca6286cc799eeb727a521ece582c46a40)), closes [#4648](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4648)
* added empty string check in markThreadActivitiesAsRead and markChannelAsViewed ([5d47153](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d4715376eec1d5bc672776a5c91605b42019606)), closes [#4679](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4679)
* ask-ai-guided-onboardin ([d7cbfae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d7cbfaed0a0ac37e14177b1167d5990d58feebb2)), closes [#4628](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4628)
* Implement workflow metric boxes ([499228b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/499228b0ad8354b14638b302675a35c1f0da41f4)), closes [#4681](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4681)


### Bug Fixes

* add participant fixx ([9cc61f7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9cc61f7445c26e402c9a43f9a546c943c0ae69c5)), closes [#4683](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4683)
* added dedup check ([6ddf665](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6ddf6658eee17713b302ab975f85a8b5a650e904)), closes [#4649](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4649)
* backfill conversations initialMessageMd ([c11cf4d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c11cf4d9ba3c2a95e8e7cbe45840254d3215ee60)), closes [#4674](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4674)
* changed virtualizer ([d0c93d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0c93d023edbbc454e822c42760edbaf4c565af2)), closes [#4688](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4688)
* optimise frontend channel loading ([8fbf7c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8fbf7c2cc8e51009460d374cde19747bfa8b1c45)), closes [#4612](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4612)

## [1.106.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.106.0...v1.106.1) (2026-04-06)


### Bug Fixes

* Fix activity time inconsistency ([1c9afe9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c9afe9e200e163ae2f5e56299122a511c9e10d8))

## [1.106.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.105.1...v1.106.0) (2026-04-06)


### Features

* add generic post proxy layer for Electron agent ([53d8a9e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/53d8a9e30a749e27e2b90fe929feb640da51956a)), closes [#4645](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4645)
* added softdelete for channel_user_status ([77540ee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/77540ee7b34d1ef974a627c6303038241a701215)), closes [#4477](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4477)
* draft saving and attachments zoho ([a013205](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a013205be6b94c2bd92807a685708b518221ee11)), closes [#4661](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4661)
* Feature/direct context xyne ai ([b99baa6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b99baa6f8b0b77d2656421e28139286d71e101b8)), closes [#4603](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4603)
* Push to talk in call using space bar ([603e352](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/603e352f63eed34f37dc1f84c244f6ba27f2887c)), closes [#4571](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4571)


### Bug Fixes

* fixed dms search to use command + k approach and add jump to channels ([c71d35e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c71d35e9a824290cf0736152ab360b228c37f933))
* Participant update fix ([8c45e76](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c45e765e191dec0da5487a46b4444879fc54c75)), closes [#4595](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4595)
* removed Jaf for activity Classification ([d3f50da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d3f50dafbf643fde3b70cde8f72fdab9584b8af9)), closes [#4652](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4652)
* revert pr for email report ([5ef1e48](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5ef1e48648063a49d5887ee0083f9997522cd2bf)), closes [#4642](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4642)
* Video Attachment bug fixes ([1ed8988](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ed89884cf2fcf6f5be4c80d4324e1724700fbc9)), closes [#4613](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4613)

## [1.105.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.105.0...v1.105.1) (2026-04-03)


### Bug Fixes

* improve native app startup ([2e76182](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2e76182bac5df618d7c74e951a944429ef3fd233)), closes [#4618](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4618)

## [1.105.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.104.0...v1.105.0) (2026-04-02)


### Features

* added local testing using opencode ([3288063](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/32880630aeb0ffaf057326e0ee29cfd30e50bde1)), closes [#4579](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4579)
* auto-rotation-between userGroup(sets) for auto-assignment ([28bdf8b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/28bdf8bd066147ac9166c00603c0c19014a4a1fd)), closes [#4619](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4619)
* calls history machine ([6a56fc8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6a56fc83e4ea34a5a15b2406dfa875b94b155f7b)), closes [#4554](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4554)
* Denormalize messages ([8c29e4a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c29e4a7e701f167379ede5478ef90fb03f74468)), closes [#4515](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4515)
* draw on screen share ([bc9b75d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc9b75d797f92bdef089ae56d135b5f04e8379e6)), closes [#4587](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4587)
* Feature to create recurring call series instance upto 60 Day ([15025b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/15025b0c6d9fc1b424b6cd05fa4e6691333299d4)), closes [#4561](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4561)
* lotus app login page re-design ([6af565d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6af565d80dc0fd8577149ed3f578665b5f8c3c26)), closes [#4594](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4594)


### Bug Fixes

* Add Grafana alerts and logs for Xyne Call ([ddfd14f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ddfd14f5aa3fe0dcd8448a16b0e40be2b6eaf9e4)), closes [#4563](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4563)
* adding channelstatus in recap ([b84179e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b84179e61c77f67e05832aef3d5f190e3d9c47f5)), closes [#4584](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4584)
* changed metadata ([861208c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/861208cae3b02d345fbb2bde01f1639efdf8dfff)), closes [#4623](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4623)
* removed contentFormat ([4dbabcb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4dbabcb7998d4e5696de43cb212e490bd0dd4910)), closes [#4635](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4635)

## [1.104.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.103.0...v1.104.0) (2026-04-02)


### Features

* channel archive ([b5881e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b5881e94bce88d06ffaf3deb88b15ea451188115)), closes [#4160](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4160)


### Bug Fixes

* suppress hover highlight on Cmd+K dialog open ([398596d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/398596ded58e6a859e34653a0c2339f45a4720dc)), closes [#4531](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4531)
* using xyne id ([a79f2dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a79f2dcbb2ceee748eba2b6607b77230de8daddf)), closes [#4611](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4611)

## [1.103.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.102.0...v1.103.0) (2026-04-01)


### Features

* added email source and report gen ([aeaa5b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aeaa5b8851d7082aa9b24368b152eaabec89909a)), closes [#4542](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4542)
* adding duration overlay on the video thumbnail like slack ([c0372b3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0372b3e14a60ec1bcaa53a16c68c1377de40852)), closes [#4016](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4016)
* adding helper fn to sync ticket_md with prisma updates ([7ff235d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7ff235d25966824ed0ef4daebf8cf99574f8bc87)), closes [#4526](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4526)
* build step disabled ([0254b4d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0254b4d4f5f106afd2782334d51206bd4b5d2775)), closes [#4588](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4588)
* fixed usecachedquery hook for updatedAt ([954ecb2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/954ecb229de1a7f747b734e812b7001fba88d590))
* Jira Migration phase 2 ([4fc287d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4fc287db0c5a72d06ddff1dcdcdaa7f46af46f88)), closes [#4589](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4589)
* log only initial zero query completion ([9ae8f84](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ae8f84f4270504fffb21c7b32c8fc437198a309)), closes [#4507](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4507)
* replace session api ([b7ef2a6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b7ef2a6adfe7824d1ee1a572407fd7feb8da7631)), closes [#4574](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4574)
* SAM transcript ingestion and meeting insights search tool ([52f24b7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/52f24b7f15326ceee1833ddcb69565d087426428)), closes [#4596](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4596)
* User Display Name ([a23c698](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a23c69867825d0feaee3e96dfdc48b6aa3834ad4)), closes [#4592](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4592)


### Bug Fixes

* added switch functionality between native and webview ([7cfec0d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7cfec0d16f813695a89c99d5a7a82ddf1019c830)), closes [#4552](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4552)
* Added vespa push for channelParticipants also ([3e4f0ca](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e4f0ca9e85f429002cef60ece603e12f43267fa)), closes [#4576](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4576)
* baseUI compatability fix ([8cc4793](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8cc479315b6e67bdd7144e21da48c47bb912cc33)), closes [#4048](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4048)
* Fix UserTags and Copy Button in Ask AI ([6d47754](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d47754245436dd99baa06936b4574c66311362e))
* Fixing Recap Citation and Improved UI ([bfb0fb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfb0fb6a34d18136749bf3a260f29792024e37a2))
* fixing the inline video player still playing when modal opens ([930b6b8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/930b6b81dde75ca52df062d199529f49f01641a0))
* remove contentFormat field from messages ([d5c9b6f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d5c9b6f6cb843df439b342e43b79aea509df4a3d)), closes [#4608](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4608)
* replaced db message, channel db calls with api ([c65db0c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c65db0c736f6bcf3141140300a26967f26343236)), closes [#4530](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4530)

## [1.102.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.101.0...v1.102.0) (2026-03-31)


### Features

* Add session history extraction logic in memoryy ([5add7e2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5add7e2d2b3cf073d980b2a2ffa44d0c2355b018)), closes [#4536](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4536)
* changes to call notification native app ([6627d69](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6627d696bb52ca74b76af0cf1d79a512295dcebb)), closes [#4490](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4490)
* jira migration setup ([2048557](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2048557940d978d1c52acf049776f40c72947270)), closes [#4497](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4497)
* native app message actions ([d4e2511](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d4e2511edc168dda3ad91de9b35b36d77f107a9f)), closes [#4562](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4562)
* workflow execution to redis ([af29c62](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af29c62ec426e8733d4f478af4520a1abd16b3ad)), closes [#4538](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4538)


### Bug Fixes

* change in the workflow rerun dashboard logic ([fe0cd72](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fe0cd727395e57eec99d9d6ea5a22fc21ac37735)), closes [#4545](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4545)
* fix stt drain on mute unmute ([be7b4ca](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be7b4ca21aa33b3c128389dfc9b90bb36862b504))
* native app activity message rendering, splashscreen and app icon ([544e4f9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/544e4f939bda24a51d81f2e17a2e093107addb01)), closes [#4506](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4506)
* pending native app change ([7fe2aa8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fe2aa82f8dbbb8efddd0fb3c4e11edfe0f451ce)), closes [#4436](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4436)
* retry configuration for all LLM calls ([20ec229](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/20ec22903c7b2d0bb59096ba0bdbc2dde821e6b5)), closes [#4500](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4500)

## [1.101.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.100.0...v1.101.0) (2026-03-31)


### Features

* Add type modifier for CmdK search ([b9952cb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9952cb02cee4417d3f033f7732d914028650492)), closes [#4105](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4105)
* added jenkins file for creation of changelog on release build ([bb23454](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bb23454e25d095f2f4ca4b676845e9ed64083ac1)), closes [#4366](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4366)
* added org picker and allowed multiple creation at once ([1a1a5f1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a1a5f178ef06ecd452c17f02436a0ab9ace7837)), closes [#4521](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4521)
* changes for native-app notifications ([d200fe7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d200fe7f32537623631fcceb013df59e314130a1)), closes [#4370](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4370) [#4286](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4286)
* files ingest to vespa ([b08e614](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b08e61414901e20bf5dc13ea11d4dc63f70f563b)), closes [#4314](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4314)
* github pr functionality ([b2930c0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2930c087e4f7b883170ff177dda89ce547e8a0e)), closes [#4458](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4458)
* impelemnts saved-ticket views be ([89705d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/89705d6f0515cddf723024861384403c0b73495f)), closes [#3517](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3517)


### Bug Fixes

* adding missing package ([25a6a51](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/25a6a511c77269b8d73c10ab7a8efc4ad004a17a)), closes [#4520](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4520)
* changes in the workflow live panel & header ([904699a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/904699a9ade89e3b1cba38eaf09984cdae52b49e)), closes [#4421](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4421)
* custom profile picture fix for calls ([b2ae612](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2ae61269166036a5ae1fc5db412eadfaedf89ea))
* default time fix ([b16e46a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b16e46aabdd4727a613e348e157f4d49e3020b00)), closes [#4482](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4482)
* fix for stale data in recurring call series modal ([215bead](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/215bead242195a20555be25844e2b5f3ec4cbfb8))
* fixed random mobile logouts ([143b702](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/143b7025e0025ee818b724dfdef238fbe9e69895))
* fixed scrolling in my dms page ([fcf2c49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fcf2c497d84e77d9b8b5ac3b8285ba487f265d43))
* Hide analytics button for unauthorized users ([17899f6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/17899f6a801e1952587cfc2261ad7ad2e8f7ace2)), closes [#4509](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4509)
* made data emoji true in case of inline emoji node ([77fa2f9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/77fa2f98a0146c72d37c9a9d82d30249ae975bd5)), closes [#4372](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4372)
* new app chat design improvement ([6ef3509](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6ef3509183283a05f4e20e8dfd34a90e06051c2f)), closes [#4503](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4503)
* Option to filter channel calls ([0bf890c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0bf890c9ee2b42306f6a896e8247087de7ebed75)), closes [#4483](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4483)
* redesign ticket workflow UI with custom components replacing blend-design-system ([5b20d6b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5b20d6b76eb8f8b944b49c67b009389b56b6c9e4)), closes [#4478](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4478)
* showing stage overdue if not eta is set for a stage ([e5be9ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e5be9ed934c6edb6d71d9aac3558d3408b56ae0d)), closes [#4472](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4472)

## [1.100.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.99.1...v1.100.0) (2026-03-27)


### Features

* add query to get latest messages at once ([853c58a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/853c58ad13d1a252aa89a0390c64f30172a60d49)), closes [#4221](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4221)
* Added drag and drop attachments and added usermentions in ask ai query ([4565c00](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4565c00445bd155e0d5631605b5c8328f1532067)), closes [#4363](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4363)
* added internal links preview and images support in external links ([546174c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/546174cb767a898119070b13434cd6dc3eb63c6c)), closes [#4020](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4020)
* added jUtils workflow ([a5c7a49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5c7a4924df4f296d028a80780c9133fc8bb4075)), closes [#4148](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4148)
* added microsoft sso ([a636d13](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a636d131dec4a201d6c0edb04d4643101d2c8a59)), closes [#4384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4384)
* Added soft delete for user groups and updated useCachedQuery hook to use updatedBy ([a663619](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a663619a579d450ea982c81c46017117286e9292)), closes [#4397](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4397)
* added support for codefile ([e7d715f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e7d715f47c525318174c7d929b0f95d144ec200b)), closes [#4268](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4268)
* Added Workflow Cucumber test screenshots in WorkflowScreen ([204fca6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/204fca62c36ce7d48d3e4746d3b6c71966b9a0be)), closes [#4400](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4400)
* create ppt tool ask ai ([2c2e22a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2c2e22a6af3e5bf63426b4220845f0fbc7382feb)), closes [#4406](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4406)
* custom userprofile ([d26de46](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d26de46aed8d2b9fdbcd99b7042be4f538b1152e)), closes [#4154](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4154)
* db-query-enhancement-for-workflows ([7fb4ee3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fb4ee35f639d51b7301b26c3869750562c2df20)), closes [#4469](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4469)
* implemented the participantInfoScreen for native calling screen. ([6ceaef1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6ceaef109d646fc5bd3368467637017e786af5d2)), closes [#3821](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3821)
* MERCHANTTI-0727 standardize log fields, refactor dashboard metrics and restructure logging readme ([f9ff07e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9ff07ec808fd053665223eeddf5980b088999dd)), closes [#4150](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4150)
* providing preview / raw code in readmeviewer ([44d9647](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/44d9647ee0364127342335e523732d5912236b45)), closes [#4444](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4444)
* recurring calls ([b9074da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9074da47192c83f355d53ac089225fca430efc5)), closes [#4046](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4046)
* search project in projectList Screen ([952fde6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/952fde657138c932f53e68fe77966604d902185a)), closes [#4465](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4465)
* support workflow ([9a46a68](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a46a683c9a598a19968b96640f1eb2167ab13be)), closes [#4220](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4220)
* switch call to different device ([1e61572](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1e615728b6f413266c25f712c9a81b7629d1a85d)), closes [#4391](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4391)
* trigger workflow rerun on github PR comments ([caa8df5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/caa8df558a21fb5bb6f333e3de2bb0bd82e62378)), closes [#4254](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4254)
* workspace-cleanup-for-every-execution-after-completion ([a541368](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a541368b44a02f8048ebf0c5acd5fba7e995a415)), closes [#4405](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4405)


### Bug Fixes

* added logs ([a6a564b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a6a564bbe4ec1e41065fd3ee53d31b3abcb35fba)), closes [#4416](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4416)
* added logs ([37fe231](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/37fe2314eb739f01b3518a8f26e90bf603afee24)), closes [#4344](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4344)
* added react native app ([e55925c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e55925c3a9d20606e111bcd71b22992667faa23b)), closes [#4377](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4377)
* added replyLayoutV2 ([d42261e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d42261e7b33c69c481baeefc1a4e7dc768fad04f)), closes [#4445](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4445)
* added type:complete to zero.run query in delta subscription ([2f5a6d1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2f5a6d1c560432c4a2ce212378b020423f3d0a7a)), closes [#4381](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4381)
* changed the email param to emailId ([538eeaf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/538eeafd31a52998b86bf509372d706803eb17f7)), closes [#4438](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4438)
* changes in agentchatpanel ([4202155](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/420215568801ef334d8ca9452ecbe972b85d3434)), closes [#4395](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4395)
* channel stats acl fix ([0432770](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/043277089d434201e72b142c4fe74eda3b587c0a)), closes [#4448](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4448)
* creating tickets from DM from call summary is failing ([8289bc7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8289bc7970ea9f93029a07d1bc36d5f322751546)), closes [#4470](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4470)
* electron logout ([b6af020](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b6af0205f06632df9f1955b4d1369cfd38f2614a)), closes [#4454](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4454)
* enable search within group DM via in : filter in Cmd+K ([6cb01bf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6cb01bf883250a0f0a1ef83960ae70f41ea0febd)), closes [#4388](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4388)
* Fix missed call status for recordings ([586e7bb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/586e7bbe06ec491ed43ec5dd80da8dcb7631d0b1))
* Fix nudge framework issue ([172749d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/172749dc160be3152edf475352092f88c449a0b6))
* fix the endCall modal ([122826c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/122826c5b03d0868bb9d6b3c07a1340775541a87))
* Fix UTC time display in call summary ([cc0dddc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc0dddce0880760237c39362c312395be5cafa91))
* fix-links-tab-visibility ([f2e3644](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f2e3644e21372138b0db670193e88d0486f08603)), closes [#4461](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4461)
* Fixed channel-user-status to allow isClosed update by participants ([cbc58ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cbc58ff9c3f17ae8ba8aa7e0b293209d2f68b1db))
* hotfix ask ai tracing ([c244323](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c2443239f9a38bc71a744bc8d1178d86aed8304d))
* hotfix channelmodel in recap ([a334c1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a334c1b0d0135275f5c80139b6b83ac36dc07b2e))
* lastActivity getting updated on thread replies ([d11fa79](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d11fa793dde1f852edd94236effbfc0ac91b7ebf)), closes [#4396](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4396)
* opencode fixes ([e7e948d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e7e948df111fd21fd378794b6a093c815642835b)), closes [#4453](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4453)
* regenerate and edit ask ai ([0f6b505](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f6b505027b558a6f0fd1268595c15ae2af95a32)), closes [#4393](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4393)
* sidebar color fix for summerbreeze theme ([71f2026](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/71f2026d070d84f747c22061cc70e35c747f1ccc))
* use consistent object format for entityNudges query enabled option ([d0c223d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0c223da9120f5abf81137175e3b819208f013ea)), closes [#4407](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4407)

## [1.99.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.99.0...v1.99.1) (2026-03-25)


### Bug Fixes

* revert recap channel status ([bf1d63a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bf1d63ac5740e732ba005ff89e315c6a759066dd)), closes [#4346](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4346)

## [1.99.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.98.0...v1.99.0) (2026-03-24)


### Features

* Add otel logs in ysweet ([95391fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/95391fd4de995aafe769066256a5b9ffbf61c36b)), closes [#4371](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4371)
* added live participant count in full call view ([1372a7b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1372a7b5f87fcaddc22c4dd9490a290aeb8891c4)), closes [#4262](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4262)
* added-delay-before-go-to-wait-for-event ([b79d363](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b79d3638416c39252ef4805e99cf07fc9e15deaf)), closes [#4215](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4215)
* MERCHANTTI-0731 add MCP server config for metrics, logs, and RCA ([c76ddeb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c76ddeb1d007c89415c6f577b57c9a4be9a8c3af)), closes [#4378](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4378)


### Bug Fixes

* denormalisation of activities and tickets ([aec4b73](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/aec4b73e2be2ac623d86616f95532f44ebf698d2)), closes [#4373](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4373)
* MERCHANTTI-0730 replace proxy pattern with getter functions for OTEL push metrics ([53b3b1a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/53b3b1ae26ac5525c866c06ad4c939007e9dc4b7)), closes [#4285](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4285)
* Summer breeze theme call action items Generate-PRD and Chat with AI are in white colour making them invisible ([eadfae3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eadfae3ddb3ea8b744d60f17770fc29f4fd7a546)), closes [#4320](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4320)
* Xyne Apps Ticket Bugs ([c520de1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c520de166cbe82a889dfa25efdc41a27aa93852e)), closes [#4334](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4334)

## [1.98.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.97.0...v1.98.0) (2026-03-24)


### Features

* Persist the query in Background on Closing using Seperate Worker Thread (XYNE AI) ([3d208d4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3d208d4a1c39e5cb6e7969b17ff1a55ff9505ec8))


### Bug Fixes

* separation of ticket message from summary message ([1ff6d05](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ff6d056a8a1ee0c1f31424711e8cd2382fd1dbd)), closes [#4338](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4338)
* spliting channel table into two table ([b524df8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b524df8d842b7b5c148d8fa492210e35400235ac)), closes [#4325](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4325)

## [1.97.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.96.0...v1.97.0) (2026-03-24)


### Features

* : Implemented direct context addition through input box ([74d506a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/74d506a659ad3f50b7ff7fcc01e6163ffc910212)), closes [#4203](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4203)
* Framework Questioning. ([d3b4be3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d3b4be37ca6634b94367feb2c0e25a0ee52dacba)), closes [#3776](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3776)
* ingest agent data to vespa ([4229276](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/42292767d7a3b42d8a8dff9bd19431b6b8129df5)), closes [#4166](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4166)
* move workflow execution lock to workflow schema ([1c01bc9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c01bc91b18aa610f5c6059aa90ccce7c3ec0272)), closes [#4281](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4281)
* non zero tables to workflow scchema ([88df87f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/88df87fe79bef04d347629caac30b4754641273c)), closes [#4316](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4316) [#4299](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4299)
* showing participant profile Picture in call tile. ([be3cf1c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be3cf1c2db65240ba6d9dbd132e482e1ff27006f)), closes [#3889](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3889)
* split getAllUsers and getAllChannels query ([2bb6844](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2bb6844b880742ceb2dd98479d6d70bb860d6b7c)), closes [#4186](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4186)
* update Y-Sweet image reference in docker-compose.yml to support metrics ([3a39639](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3a3963900a6cf206e8c5ad72bec9e6f139e26fdf)), closes [#4319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4319)
* updated zero version ([9f25599](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9f255996f27f71c7fbd9ebc738264e2da1ce61e8)), closes [#4145](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4145)
* workflow rerun reply & create automation run remove ([75dc613](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75dc613ef418af3b176133a2e190580a3a277979)), closes [#4251](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4251)


### Bug Fixes

* : revert of direct context addition through input box" ([180a13e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/180a13e15c7f73595e22ab600540962bd591cbc4)), closes [#4347](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4347) [#4203](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4203)
* Add markdown preview in memory search result ([1bedd1c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1bedd1c769918df2d55be81a2e02a02b835b2ed8)), closes [#4195](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4195)
* added recap channel status ([5eb10ca](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5eb10cadb52cd3a01aa7c45a136e5d0a90cb813e)), closes [#4267](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4267)
* automation updates ([c9c9d9b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c9c9d9bbd5d8b7f58339ab6ebe09fc534436b0fa)), closes [#4283](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4283)
* changed splash screen ([71fd9cf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/71fd9cfdd4f77bd384c5b8944efd1f06bbc37c15)), closes [#4266](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4266)
* fetch missing email fields from Zoho API in webhook processing ([ba7c246](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ba7c246e82079ac314b8620cda6741ae9530997f)), closes [#4211](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4211)
* fix channelDailyRecaps query ([e860254](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e860254801c77b7a6d75b12403cff64df2a9cb4b))
* fix pagination of calls page ([7e9229f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e9229f49b83d163e9b55948430c04539372826a))
* fixed  automation ([f5cd8af](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f5cd8af51ba06e54a4750e3ea740665028471dd4))
* fixed bug where reloading after dm causes the screen to be stuck ([7c5958b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7c5958bf38f317a087eea0ace908d35a6e8e0220))
* Jiraffe migration bug ([6cd5086](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6cd5086dfc70e185a09886236df4869b72cb15db)), closes [#4340](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4340)
* linter formatting fixes for sidebar and surface changesService ([a51590f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a51590f4d55ec1607cb983d0750e79e8f91ae6c4))
* remove unwanted system prompt in workflows ([196f61a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/196f61a02e10ce399beb7bdfa409a9ada855f17e)), closes [#4132](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4132)
* replace heavy queries with light ones ([bde0655](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bde06556b807e94a1144bd2e948d637a91010524)), closes [#4206](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4206)
* Skip workflow rerun if already running for pr comments. ([4e55986](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4e55986a3c329aee684417b1c286eff32f989471)), closes [#4165](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4165)
* update baseUrl handling to resolve 403 Forbidden errors in Y-Sweet integration ([439a595](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/439a595f2ba85db5c5af9598014a27ab7182a471))
* User can create a call in an open channel which they are not a part of. ([e0f228e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e0f228e7a37449850242e168a5a6f2a9805982b1)), closes [#4282](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4282)

## [1.96.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.95.0...v1.96.0) (2026-03-18)


### Features

* add rerun in deterministic steps + more ui changes ([67cbd71](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/67cbd7178b2511efdcc41cf72db364e930f0e70a)), closes [#4202](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4202)
* ask ai browser plugin ([372579f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/372579f510bc4b76f0743c7fa21766c9c6fb8039)), closes [#4167](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4167)
* record multi user ([ca72649](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ca726494bdb187251134c70d59449837a5b4b393)), closes [#4198](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4198)
* Retain Cached Conversations ([0ba6e5e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0ba6e5eec81b3fbae5bca6b7b90c9825771b8558)), closes [#4084](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4084)


### Bug Fixes

* :Auto-generate release notes upon ticket completion ([dd9ae70](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd9ae708ffaaf9f425761fb1cf08719d85712a58)), closes [#4152](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4152)
* Add pagination to Call History Screen ([719a8c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/719a8c2094f806316693b8a9423a6abe907f31f2)), closes [#4200](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4200)
* add ticket ID (xyneId) to search results subtitle in Cmd+K menu ([46b0f78](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/46b0f78c6dd1b9d11f1e1130f4ffb1d7cec2b67f)), closes [#4120](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4120)
* Jiraffe migration bug ([48755bb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/48755bb440873a9354c2c0ac495d70b8bafaa69a)), closes [#4209](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4209)
* remove unnecessary recap access check and simplify recap button rendering ([b719e26](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b719e2623c3d177ad91c2820b4158aaadc9d3e34)), closes [#4196](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4196)
* Update workflow attempts view ([695a466](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/695a46681c785777c48c90e455d58880760335d5)), closes [#4180](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4180)
* Xyne recording delete fix ([929bc17](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/929bc171acc8b3587370c43d049fb7a9b3a4876e)), closes [#4204](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4204)

## [1.95.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.94.0...v1.95.0) (2026-03-18)


### Features

* support dynamic project prefixes in PR validation ([5fcf991](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5fcf9919b3314db255cb297e0a28fd9d43c56bc4))


### Bug Fixes

* add Redis dependency for superposition v0.100.0+ ([ff72570](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ff72570b1b55c109c900fc60bdbd8ff27d07e8c2)), closes [#4190](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4190)

## [1.94.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.93.0...v1.94.0) (2026-03-17)


### Features

* : added edit functionality ([909688d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/909688dd4e4677894e5770235d94fef879ab244e)), closes [#3878](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3878)
* Added auto assignments for xyne apps tickets ([ace24b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ace24b0d401fe3a4f64c2abe7c7fae88761fd7e2)), closes [#4185](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4185)
* Channel Level Notification Pause added for Users ([ea9450e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ea9450ef2cc86870448b8c2549fe4034c0322782)), closes [#3831](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3831)
* dark mode in board creation and editing ([3c94ac2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3c94ac2a3d6bb40e5a259c74f4694e48e248fb70)), closes [#4147](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4147)
* repalce react-diff-viewer with diffs by pierre, and fixes in workflow trigger modal and agent chat view ([c9e4864](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c9e4864180a1c196b8f57e6d15215ebdbb623c95))


### Bug Fixes

* fetch only status's form in board's condition builder ([1b650c2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b650c299e80296e8be28d558c87c42e652a29ca)), closes [#4156](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4156)
* Jiraffe migration bug ([5f82553](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5f8255373c2d8f79047ea6b9e646e7b37c1841b2)), closes [#4184](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4184)
* Jiraffe migration bug ([b74e4f1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b74e4f198d20c43890d171397245d6c71dc956e1)), closes [#4169](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4169)
* Used redis set to maintain keys ([de12927](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/de12927f6d3a40b3ac9e56df627f2dc042c5ca36)), closes [#4164](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4164)

## [1.93.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.92.0...v1.93.0) (2026-03-17)


### Features

* Add memory retrieval and index flow ([eae1f02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eae1f028e0da0707c6e5546720d76c6437d4efe0)), closes [#4097](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4097)
* automation setup ([534638c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/534638c83b284b553bc8a5f97d7fd17fc17dd391)), closes [#4121](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4121)
* ticket archive ([c6360d0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c6360d0bb5062c07ca0f754065976a24f2652e3f)), closes [#3976](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3976)
* Xyne Apps webhook support ([079ab4f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/079ab4f326009f0f5d5ac718989add5751579d93)), closes [#4114](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4114)


### Bug Fixes

* fixing scroll and list highlight in canvas attachment popup ([1c95d15](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c95d1513798fa80c2aba8475b5ae493a2c05c43))
* Jiraffe migration board mapping issue ([15fc205](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/15fc205e20e1949be783cb88c964d22e8ec19ee2)), closes [#4143](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4143)
* update [@blocknote](https://ssh.bitbucket.juspay.net/blocknote) packages to version 0.47.1 and bump blocknote-layout to 1.0.21 ([9b21eeb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b21eebc853c606d3cebf52f3d1d0bf40517a357)), closes [#4118](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4118)

## [1.92.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.91.0...v1.92.0) (2026-03-16)


### Features

* add browser settings management for JavaScript and popups with a new UI component and Electron service. ([bfe15e9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfe15e968fa40a52f7b514f115b0d04bc86fd4c0)), closes [#4128](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4128)


### Bug Fixes

* added dummy google login for getting emailId before enrollment ([edf1505](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/edf1505ab6122a8858a24f3d92d4eb9f4722f500)), closes [#4144](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4144)
* electron crashreports and fix for notification banner ([9ceda7d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ceda7d88811217eb8a0f8f906abf5ecf9fdb155))

## [1.91.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.90.0...v1.91.0) (2026-03-16)


### Features

* fix issues in my tickets automation ([11bcfb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/11bcfb6aef4f6206e9858150e207f8af47d9d9ff)), closes [#4023](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4023)


### Bug Fixes

* Fix user tagging failure during message forwarding ([68f5c86](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/68f5c8632a2f45eeb8fbf02b64846b97cbc5236f))
* update Y-Sweet document initialization and sync methods to use DocConnection ([bfd6183](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfd6183973cddc58952086a1ebb2777e1845364a)), closes [#4126](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4126)

## [1.90.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.89.0...v1.90.0) (2026-03-16)


### Features

* boards config revamp ([cc3e0ab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc3e0abfb998edf845f3b05d8108cd4b9500e6a7)), closes [#4099](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4099)

## [1.89.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.88.0...v1.89.0) (2026-03-16)


### Features

* | Multi repo version bump workflow ([306d27f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/306d27f394ce909fea031124156fc5c95fa8496b)), closes [#3919](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3919)
* Jiraffe Migration ([c02da62](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c02da62c02b0195042eddf0b0ba170b4698e2490)), closes [#3973](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3973)
* update automation script ([4ec4e52](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4ec4e5223a2388a8559717d9c512c91f76101407)), closes [#4093](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4093)


### Bug Fixes

* ETA calendar fix ([e90a3f7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e90a3f7c48e3a400122f4765d31f36c132c57084)), closes [#3929](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3929)

## [1.88.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.87.0...v1.88.0) (2026-03-16)


### Features

* migrate-query-and-fallback-endpoint-to-read-replica-pool ([a03bf35](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a03bf355227e733e22c288c35781c3ccde557959)), closes [#3974](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3974)

## [1.87.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.86.0...v1.87.0) (2026-03-14)


### Features

* Meeting Detection ([c4cefb4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c4cefb43cec5144093ed6132199ebecd0efba075)), closes [#4044](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4044)

## [1.86.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.85.0...v1.86.0) (2026-03-14)


### Features

* native auth change ([abe038d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/abe038db3dbaab39b09bb299ab5736b20533dc43)), closes [#4098](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4098)


### Bug Fixes

* removing functional test case skipping condition ([6114a5f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6114a5f18736b837558f35c3d38a7ddca42dff88)), closes [#4102](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4102)

## [1.85.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.84.0...v1.85.0) (2026-03-13)


### Features

* Xyne Apps Integrations ([576055c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/576055c1413c89062a2469707b6f9f6150a9b016)), closes [#4039](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4039)


### Bug Fixes

* changes in workflow trigger modal ([ad736da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ad736da19d3845699e1bcb6221944385eca6176a)), closes [#4095](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4095)
* Merging with cached fix ([5d2a38f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d2a38fb5da25485c2cc9d72e08fe93728693be0)), closes [#4090](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4090)

## [1.84.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.83.2...v1.84.0) (2026-03-13)


### Features

* Add missing indexes ([6530e56](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6530e568e9342563a1d309ba34a4407281d62efe)), closes [#4033](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4033)

## [1.83.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.83.1...v1.83.2) (2026-03-13)


### Bug Fixes

* fixed call history in thread calls ([12d54dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/12d54dc9af069462c22bd354c7c35c6696bd21fb))

## [1.83.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.83.0...v1.83.1) (2026-03-13)


### Bug Fixes

* Fix arrow key navigation in Cmd+K search dialog ([fa546da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fa546da8b186099a7e48e4977a9bfc1f3329b50a))

## [1.83.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.82.0...v1.83.0) (2026-03-13)


### Features

* : Generate release notes ([037e57a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/037e57ad6f26df2001cab0fd4ab0ca8c7682109f)), closes [#3955](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3955)
* workflow ui improvements and fix ([bc60ced](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc60ced03c5b1f026972cc71fd3686f78edd07f7)), closes [#4057](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4057)


### Bug Fixes

* add disabled state for "dowload transcript" and "go to message" button ([6aceeac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6aceeacf04c6c4bacf437675eb537fdc263a139e)), closes [#4083](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4083)
* update the canvas in schedule calls when the last participant leaves the call after joining again ([cb27384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb27384ee744fbad9f8ecf6018e27881088956cd)), closes [#3987](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3987)

## [1.82.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.81.0...v1.82.0) (2026-03-13)


### Features

* Context rebuild for wait_for_event and manual rerun for workflows ([75af576](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75af576b03b722624a4b4ce2fb4db6e08acd542d)), closes [#4079](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4079)
* xyne space workflow loop with review ([1631723](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/163172352a3f4a39a857d2ec0981f04fce0db490)), closes [#3765](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3765) [#3855](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3855)

## [1.81.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.80.0...v1.81.0) (2026-03-13)


### Features

* Daily Channels Recaps ([f0f823e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f0f823e4e0e7747dc2f432a11c6d0c3ab60985c5)), closes [#4019](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4019)

## [1.80.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.79.0...v1.80.0) (2026-03-13)


### Features

* temp branch based report collection ([c1ceb3e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1ceb3eded9cd9ee36a5da960b9590a8d975d77e)), closes [#3962](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3962)


### Bug Fixes

* Canvas query fix ([b6a4764](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b6a4764b0dc8240934503b19909e8af94ed60fb1)), closes [#4062](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4062) [#4056](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4056)
* Conversation participation avatar fix ([907b6b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/907b6b01ca9a2d7e462f18f5740b2076569d202d)), closes [#4074](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4074)

## [1.79.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.78.0...v1.79.0) (2026-03-12)


### Features

* Implementation Review is not happening in Plan-Review Loop Workflows ([bf016fb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bf016fb8ba337c9e28f29642b6777e55ab15f9e0)), closes [#4007](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4007)


### Bug Fixes

* fix issue of missed call status ([c051cd9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c051cd90ac885659c6b175770f7fe14ee7caf490))
* fixed call automation ([a5eee1a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5eee1a27a12ccb06cc91aab4fad1e3b8a738c5b)), closes [#4023](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4023)
* fixing css in themes\ ([e45b46a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e45b46a43abf03eb365782ac74bac2347390aba8))
* replaced loadUrl with webContents.reload to prevent app crash ([65f16c6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/65f16c63e17b571f41a7c2bb5cff7719d7011c17)), closes [#3988](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3988)
* syncing the prompt fix to main ([4ad8823](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4ad88231d411581e88a9879a005bb5257566b075))

## [1.78.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.77.1...v1.78.0) (2026-03-12)


### Features

* activity dm automation ([7444a49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7444a493e0e53eb232267373e53638056a4681b0)), closes [#3983](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3983)
* added-hashing-support-for-workflow-keys-in-redis ([f78c776](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f78c77625232818eb93cb4299fba65ba9a457ebc)), closes [#4021](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4021)
* llm failure logs ([5033981](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5033981aba0e7f2b00b4c517c3e2b6f65d043010)), closes [#4043](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4043)
* march changelogs addition ([89f3de1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/89f3de11c3e21ccf402a979c3fc459dc14a44df7)), closes [#3977](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3977) [#3731](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3731)
* my-tickets automation ([0939be1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0939be17adb4ad27ae68f99d34d0c5ce8c01653b)), closes [#4023](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4023)
* project scoped ticket ([76c2bf4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76c2bf47cc18d3f3a396c8d031f4939df7fb0ee0)), closes [#3808](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3808)
* workflow ui changess ([3ba781d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3ba781de34e65b8d842ed81e9c403c091e57345b)), closes [#4012](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4012)


### Bug Fixes

* bookmark automation ([59b0a8d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/59b0a8d10290499253697bfa81811eeaf52e828e)), closes [#4014](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4014)
* dark theme ([4adece8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4adece806d9a9fc179d8d896426953be65cbe7f8)), closes [#4022](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4022)
* fixed the duplicate ticket suggestion issue ([a611b88](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a611b889b3ddb78d31ba5e8a2decde6803311131))
* Refactor ChatList ([d21d121](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d21d1215c438e8247bb22139fa84219176d3002c)), closes [#4013](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4013)
* removed health check ([3cc3402](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3cc3402510634ca53f7e1506092a8ba7cbf1b318)), closes [#4031](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/4031)

## [1.77.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.77.0...v1.77.1) (2026-03-11)


### Bug Fixes

* - revoke any session with same voip token during login ([2981c70](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2981c706e89c11d3f3320379b866158f31363b80)), closes [#3869](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3869)

## [1.77.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.76.0...v1.77.0) (2026-03-11)


### Features

* activity automation ([c3d4863](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c3d486378d93d157e655c4b42ddf0cfb3ca94c41)), closes [#3963](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3963)
* Add canvas add support to message input box ([e2bfabd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2bfabd3b800c38e6468298119d4b8b7c3d4c6e1)), closes [#3870](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3870)
* Fix scrolling for long forwarded message previews in delete modal ([dd8ddb8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd8ddb8ccbf724527e0adcbb1b859f10c308bcc8))
* Retain search queries when navigating Board tickets ([a0ccf23](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a0ccf237fe0d295455cfd98b9a47396930f2e0c3)), closes [#3597](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3597)
* status updates automation ([005354a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/005354a8e223a17f800de58042b04be6d5f6cddb)), closes [#3702](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3702)
* ui changes in the workflow chat panel and tool steps ([b0939ed](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b0939edd4188fafd9700ef99fac45e73bd58afef)), closes [#3975](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3975)
* user group creation automation ([7a9e3c6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7a9e3c669e0262cdbe8c3a99ddd5e8d503db9e78)), closes [#3964](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3964)
* workflow_steps_migration ([8526c33](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8526c33fdd19f067d6eac4d0c0940c217684bfa2)), closes [#3832](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3832)


### Bug Fixes

* changed the default model name from glm-flash to glm-flash-experimental for duplicate ticket check fix ([10bd854](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/10bd854439f97df31911dec12185986a52da2c64)), closes [#3981](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3981)
* context from pulse ([baec634](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/baec63485f8b3cdc14b9d6db1b43001f4209d5d5)), closes [#3992](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3992)
* ConversationById query ([557b10d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/557b10d6b9a35cedce26c17f3e12f6ce970f3521)), closes [#3921](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3921)
* Fix profile popup z-index overlap on small screens ([151f546](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/151f546b553bbb97afacaae6687aeb35e52082e6))
* native call improvements ([fb2b0f8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fb2b0f8e1b66d37b14b97920aac4f14ed6b95f8f)), closes [#3883](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3883)
* Preserve table formatting when pasting into chat ([6816e21](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6816e216277c422f4f2dd311cb2bb16217a044d2)), closes [#3939](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3939)
* removed notification for build sucess ([da9ee24](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/da9ee24b768adf6fb09bdc93997d985307f76bf9)), closes [#3824](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3824)
* Selected participants cacheing in search inputbox ([860e872](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/860e8724dca33a047dcee3450940363118657b8e)), closes [#3978](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3978)
* status indicator visibility ([96d1865](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96d1865a29427526d32180e659890a1d036d34b0)), closes [#3999](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3999)
* Workflow UX Fixes ([e416c7a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e416c7a262bd1f1c2ec791226a202da16a02c9a8)), closes [#3913](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3913)

## [1.76.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.75.1...v1.76.0) (2026-03-10)


### Features

* Register Electron deep-link handler before app ready ([2416e90](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2416e9034072943952e70ff4673c0919023e8ff5)), closes [#3953](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3953)


### Bug Fixes

* added affected user's email in xyne-auto rca workflow trigger ([a5d698f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a5d698f848ab774935ba1d8fdd2ed84b8892b098)), closes [#3960](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3960)

## [1.75.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.75.0...v1.75.1) (2026-03-10)


### Bug Fixes

* make new workflow instead of rerun when triggering workflow from bitbucket. ([0f07bd9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f07bd92e4cceeb5a1b8a030c9428ddd096d5a78)), closes [#3930](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3930)

## [1.75.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.74.0...v1.75.0) (2026-03-09)


### Features

* add agent chat in desktop ([5e47f8a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5e47f8aa07b841f43608ce0bb928f4ac43d1198a)), closes [#3934](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3934)
* added xyne-rca workflow ([183c56c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/183c56cf0013e6a9064564efa2bbfa5949a03724)), closes [#3932](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3932)
* v1 optimisation kanban screen queries adding more granularity to queries ([4b82d15](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b82d15cf023aa8c21239dc28249a20eadfce25d)), closes [#3622](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3622)


### Bug Fixes

* dont show modal for disconnected state ([dc3d6be](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc3d6bece6cfcbc7a1af5660f5f87c86e0573425)), closes [#3942](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3942)
* fix schedule calls ux changes ([47e1d68](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/47e1d686d37c289739a48209545cffd6030079af))

## [1.74.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.73.0...v1.74.0) (2026-03-09)


### Features

* bookmark automation test case ([4cce356](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4cce356a4af60a7a4147ecd636e5e64afcfd0a78)), closes [#3912](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3912)

## [1.73.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.72.1...v1.73.0) (2026-03-09)


### Features

* added logger for debugging SAM meet summary api ([6def95b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6def95b9b2b4d5a0d881d5274c9331d15c2387e0)), closes [#3927](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3927)


### Bug Fixes

* dark mode changes across app ([6f70780](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6f707806e2f206a4413e1538d9e6c03c1b3a57de)), closes [#3781](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3781)
* workflow stale status ([03118b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/03118b9737420cd26c3dd7508c480ea667bba430)), closes [#3735](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3735)

## [1.72.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.72.0...v1.72.1) (2026-03-08)


### Bug Fixes

* made local store synchronous using mmkv instead of async-store in app ([91fc7b6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/91fc7b6815a1d342b9463aedd8ea93eec77e5b8c)), closes [#3915](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3915)

## [1.72.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.71.1...v1.72.0) (2026-03-07)


### Features

* schedule the calls ([d788995](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d78899552eb0c6cf8482f070f4da59aa2353e836)), closes [#3722](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3722)

## [1.71.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.71.0...v1.71.1) (2026-03-07)


### Bug Fixes

* Change default landing screen on mobile from Home to DMs ([f8bf04d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f8bf04dae5333862a82d2f2c8d4b82c2289824ea)), closes [#3918](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3918)

## [1.71.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.70.0...v1.71.0) (2026-03-06)


### Features

* mute-participant ([308cfb3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/308cfb33da17ddc75eee7f019d9345e400b38cc3)), closes [#3857](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3857)

## [1.70.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.69.0...v1.70.0) (2026-03-06)


### Features

* added popup and manual reconnection button to improve UX ([7749a47](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7749a476971813efbb9c9d99546eb82b396c0710)), closes [#3239](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3239)
* Fetch Internal links content using Ask AI ([17567dd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/17567dd97cbdd3c2b283d8348d0d767f2771575d)), closes [#3867](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3867)
* Preserve table formatting when pasting into chat ([7fcc1d9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fcc1d930979320a4a7e0829ce04de6140f4cdf2)), closes [#3627](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3627)
* Workflow Agents Chat ([713c63a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/713c63a258c6cd2e6c10e4b7fbde07f5b03ff845)), closes [#3886](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3886)


### Bug Fixes

* adding tracking metadata in zeroConnectionModal and refresh button ([f4ae974](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f4ae974aa9315c7418b3812568acf9d850adf3b4)), closes [#3914](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3914)
* changed accessibility level ([b20d308](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b20d308ab72cd795b67f661bb20c0adc4aa7866b)), closes [#3894](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3894)
* migrate agent configs to CAC ([14c1165](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/14c116530c42d34ceeec4e7b796fbc06fa60db49)), closes [#3896](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3896)
* migrate backend metrics from pull to push method 3 ([5e94406](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5e944067422fa95576abba095d8bc92ac3f73915)), closes [#3885](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3885)
* sustain ask ai chat on channel switch ([bbce2df](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bbce2df1cddf9569463058221fe02fcda60d7617)), closes [#3904](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3904)

## [1.69.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.68.1...v1.69.0) (2026-03-06)


### Features

* : added precommit and instructions ([264f346](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/264f346b083dc982cfdb216171ad2511b0803029)), closes [#3887](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3887)
* prompt improvemet and better error message. ([9890ff2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9890ff2cad707591e490927a860a1e8fa59d7ed5)), closes [#3879](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3879)


### Bug Fixes

* Fix dismiss and related ticket/message links in nudge framework + added cac config ([2ddcd51](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2ddcd510bbd3ed386251e71040698864e969d156))
* workflow fixes, changes in the workflow screen, fetching only workflow, minor UI fixes ([c77d38e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c77d38e02796a22ff3ac587733a0f36957b73395)), closes [#3881](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3881)

## [1.68.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.68.0...v1.68.1) (2026-03-05)


### Bug Fixes

* Show rejected tickets under boards and handling escape sequence ([b74ef64](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b74ef646337a929e7a53e8e7b411b6af0deeb5b8)), closes [#3600](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3600)

## [1.68.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.67.1...v1.68.0) (2026-03-05)


### Features

* added indexes on activities and refactored userActivitiesPaginated ([96c283a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/96c283a6c8acb65ec9736c404567fd082d20640e)), closes [#3789](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3789)
* Xyne Workflow with Creator and Reviewer Loop for every steps ([bf8fbd6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bf8fbd61b1cef1441905252821f5445e590ae9f3)), closes [#3798](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3798)


### Bug Fixes

* dark boardChangeEtaFixUpdated ([f9cff63](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9cff636cad15269d678d97179f59eb6be19a384)), closes [#3841](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3841)
* file-permissions-filter-fix ([7fa7938](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fa7938744dd6c476c7b2b1a3fde28331299dfda)), closes [#3860](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3860)
* transcript-navigation-fix ([b6b1c2d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b6b1c2df6eb7d8ec55a2e17349b75aa969ede824)), closes [#3871](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3871)

## [1.67.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.67.0...v1.67.1) (2026-03-05)


### Bug Fixes

* Fix mobile profile access from chat bubbles ([3069721](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/306972159beb971f3a3811e5e64f5dff556fb966))

## [1.67.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.66.0...v1.67.0) (2026-03-05)


### Features

* add logger to add context button in threadd ([6787445](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/67874455349088815de207813f0e1c5daf74dc4f)), closes [#3843](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3843)


### Bug Fixes

* : ask ai configs to cac ([be83f0c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/be83f0cbc8a98c9d635d6bce2d11e510dba7cfaa)), closes [#3837](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3837)

## [1.66.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.65.0...v1.66.0) (2026-03-04)


### Features

* add nudge framework with evaluation engine, definitions, and schema ([e21125c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e21125cbebdaf0d49f747bf7ce0cc41ad0722679)), closes [#3729](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3729)

## [1.65.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.64.0...v1.65.0) (2026-03-03)


### Features

* added entity wise logs in kanban board screen for analysis ([6d037c6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d037c6bd3f7b27aade1aff67675ea9eb5c946b1)), closes [#3807](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3807)


### Bug Fixes

* :Mentions PR author in release canvas ([03e2a02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/03e2a026363919134a417f20aeb2ee5a480bacf2)), closes [#3829](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3829)
* alot of workflow changes, live edits show main, error dropdown, fix the description ([bfa0798](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfa07988b816fd409deb6223f293474011715716))
* custom emoticons on user profile ([f57570c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f57570c35914024332a2c69aa28a6b65b7609f42)), closes [#3513](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3513)
* mtls cert, endpoint change for sandbox ([61dd16d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/61dd16d45e51f32f88a6bcacd5750e4307896406)), closes [#3811](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3811)
* Workflow UI changes ([d6821ce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d6821ce1b152947a76d039f1c05a9cf1589a7114)), closes [#3790](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3790)

## [1.64.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.63.0...v1.64.0) (2026-03-03)


### Features

* add context to thread via global search ([cf454d2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cf454d2201730f2dbee1cbd7ba08f553e6c67cb6)), closes [#3820](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3820)
* add integrity debug workflow with research agent integrations ([5c4edc1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5c4edc101a011a268016b711e71b5b14e98664ae)), closes [#3655](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3655)
* add ui  for board description ([9b5dc41](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b5dc417dce4e7ffd8ece1b1ec0a965725028218)), closes [#3815](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3815)
* added an interactable thread panel ([c7ea584](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c7ea584a17644ec8a9392a3f73c7944b9841edb8)), closes [#3527](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3527)
* added wrapper for zero.run() ([a18d6cd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a18d6cdae80ac5f00f841afbe2681c7a70f41426)), closes [#3623](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3623)
* full canvas support from xyne ai ([3c5dde6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3c5dde618592d77f2c6fa7a57378d8167a1e4820)), closes [#3819](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3819)
* Tagging feature in Xyne AI output ([e083005](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e083005180c441ed0e8af28ba4c42dc1a4466662)), closes [#3164](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3164)


### Bug Fixes

* changes for command menu tab filter fix ([d05f7c9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d05f7c949085e59b2bf6330ec90b428514bbe805)), closes [#3318](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3318)
* delete attachments on upload failed ([0dc676a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0dc676ab1282f95082df7f07bd5290163c43cf02)), closes [#3606](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3606)
* Fixed channelParticipant query getting called constantly in chatBubble ([8cc073a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8cc073a30aa5ac011fad9e5caad17f1aab87c710))
* Fixed Create ticket button in mobile view ([d790e8d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d790e8d43b8f017d9f3e8c71b4d925f8bd98351e))
* fixed the border ([1204567](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1204567fbdf5e7fc03d1c4d5d36daf16bfd84126))
* fixed ticket automation ([e6ed1b2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e6ed1b22761d0a5f66d08942288a706adf9ec525))
* modified the ticket suggestions prompt to create broader tickets based on task-similarity or assignee. ([9db3084](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9db30842243be05c77878268e472f6490b2b00bf)), closes [#3668](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3668)
* Thread call ui fix ([ec0292f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ec0292f543931e1f4fb61e839e024aa960e2d1bb)), closes [#3799](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3799)

## [1.63.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.62.0...v1.63.0) (2026-03-03)


### Features

* sandbox support for electron app ([2063c7d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2063c7d7d20f7b2b3dcea75e57b71130f4a60cd5)), closes [#3766](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3766)

## [1.62.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.61.0...v1.62.0) (2026-03-02)


### Features

* add crash error handlers in electron app ([cea2959](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cea2959f2a79efbebffea301403868fe5ca34b5f)), closes [#3685](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3685)
* Add search support for canvas, call transcript ([6253901](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6253901f4c0dfa8902815e4fc09f7c60baba9925)), closes [#3667](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3667)
* chat with call transcript ([10ed65b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/10ed65bd52b152473e9a979a6c41dd622d05bed7)), closes [#3724](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3724)
* Grant board edit permissions to project admins ([cd73c78](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cd73c78acecaac3b67a9721ba1c83d5a14b8d65e)), closes [#3653](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3653)
* relation mode prisma ([ac903e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ac903e41cb66c582fb5559e104fc1011b4f886e0)), closes [#3767](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3767)
* test automation refactor ([76730df](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/76730dfb0ae97e711135851ab77cb9d2009eb714)), closes [#3768](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3768)
* Thread Level Context Retain [XYNE AI] ([f3779f7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f3779f7cde24994c0fa0037743c8885a08bb2d43)), closes [#3693](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3693)


### Bug Fixes

* add live edits panel to workflow screen ([4afce43](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4afce438af5f089d797b71cdfc0b8be3d1c38857)), closes [#3746](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3746)
* add pendingUrls prop to fullscreen browser ([f46dc41](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f46dc413efb988a086c3678e9c430b50d873af76)), closes [#3759](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3759)
* duplicate constraint violations occurs ([779af11](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/779af1159059cb954d9c72280cc2eb067d138b61)), closes [#3783](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3783)
* optimize workflow fetch query ([b298f4f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b298f4f03bb30b62256cf6707bbf4b633b789c8c)), closes [#3764](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3764)
* proactiveNudge auto scroll when staying close to InputBox ([492caab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/492caab987f5633e5bdc3f0a2f00cfd56c60b01e))
* TicketType classification ([1283a65](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1283a656112c5d3681de10d043eba3d1d72b11c8)), closes [#3777](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3777)
* workflow add errors on top, add search functionality, remove code editor from workflow screen and add persistence in workflow filters ([e9dfc03](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e9dfc0329d455b99a68f66b052cb3b7eab236f35)), closes [#3788](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3788)
* workflow add errors on top, add search functionality, remove code editor from workflow screen and add persistence in workflow filters ([610d1e4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/610d1e470d431628102fa2f702d013b158beb6e6)), closes [#3782](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3782)

## [1.61.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.60.0...v1.61.0) (2026-03-01)


### Features

* add endCallForAll Native ([c110577](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c110577e266231378545ea01badf78dde4405761)), closes [#3656](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3656)
* Added Title genration support for thread call based on conversation ([8fe29ca](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8fe29ca504ba579cfa2938efdddfd11f8f9fdc52)), closes [#3721](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3721)
* Implement ticket thread subscription and notification button re ([9654ab9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9654ab98153999ecb3e14ec203a6815731ceb3b3)), closes [#3646](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3646)
* stage optional ([468c130](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/468c130e02b1f9d22bc009e0d4985fe117a356f1)), closes [#3397](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3397)
* workflow trigger data persistence ([4cf95b2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4cf95b255e27500b4ef541300c07077292191843)), closes [#3635](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3635)


### Bug Fixes

* added minimize option in browser ([17a512d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/17a512d360f6bf0e96d22a6d02a392ce5b471b15)), closes [#3725](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3725)
* Cmd K tab key navigation ([93292f9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/93292f95fc23d16a6f69438ac0ee06a76f4a7573)), closes [#3640](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3640)
* Fixed ThreadList navigation to correct origin ([05296f2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/05296f232f8fda6bc867e9cbc196c2f2515a58ff))
* making baseBranch mandatory ([267ce63](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/267ce636399ce4e05042c98d66c7a7c324034126)), closes [#3758](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3758)

## [1.60.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.59.0...v1.60.0) (2026-02-27)


### Features

* add QA alert bott ([4503bde](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4503bdebf5dea33a8ec45bb2a69011cd5d13cf4c)), closes [#3495](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3495)
* CMD + click to open Tickets & Canvas in new window ([ed6f8ee](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ed6f8eeaa50ef1314f582f5b0c436e5b66b729b8)), closes [#2985](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2985)
* Feature/DocThumbnails ([112067b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/112067b6805bd41f84da4e4adbd5a59d266cc1bf)), closes [#3602](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3602)
* including emailSubject for blocking tickets ([f8d2b59](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f8d2b591c6ead231c02ae05ed1c387965ee243c6)), closes [#3611](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3611)


### Bug Fixes

* : Added release analysis to canvas ([8510685](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/851068549dc82040440dab950929b87dae85a67f)), closes [#3414](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3414)
* add pr validation for workflow prs as well ([da95947](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/da959473384b6088e8b424d95b5838ce1aa0d7f9)), closes [#3543](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3543)
* alias-filtering fix for user activity ([6fd4b9c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6fd4b9cb96f405eecd1b9f9ad273829cec97928b))
* Removing call duration from leave button ([44ad2da](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/44ad2da8b3f7e44b88dc98d3baa5ab6a25560a43)), closes [#3709](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3709)
* webview target blank handling ([75bf3bf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75bf3bf52b456caa0676dd7383196f2578e831b0)), closes [#3687](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3687)

## [1.59.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.58.0...v1.59.0) (2026-02-26)


### Features

* : Implemented a new xyne_rca tool for the Xyne AI agent ([15bca9a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/15bca9a367d422ffb67c5e9838583d10754db729)), closes [#3474](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3474)
* add optional title to PublishRequest for markdown publishing ([9a3103a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a3103a6bce61d415f07fa49cfec4b62921afeb4)), closes [#3588](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3588)
* added recorder in desktop ([d130ebf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d130ebf3e4e35f9893c56046dd8f8bae39d9bf34)), closes [#3678](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3678)
* AI_assisted_board_detection_for_ticket ([5d9e5c9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d9e5c903d894dc5924cdf1014e84d3237680980)), closes [#3144](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3144)
* alias for modifying existing names and categories ([41cbcd8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/41cbcd83b950c709d1472ad74975671450c3b54e)), closes [#3649](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3649)
* backend event ([47a5a49](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/47a5a4982972869112e9f64fcb6813bdf94a123d)), closes [#3682](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3682)
* board transfer stage set ([5a39cbc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5a39cbc7db1382906765886e7be0cbcf4c6f439c)), closes [#3455](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3455)
* call recording thread share ([382c017](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/382c01747d4a36a86d364390b7037eacaab3d5de)), closes [#3619](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3619)
* Enable call initiation from conversation view ([98bc1ac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/98bc1ac7723d22d274a7a9b27b53c7b7cc97d7c5)), closes [#3334](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3334)
* enable linter for user activity tracking ([04e585e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/04e585ed6ed1a833f409dd0d45a5943fa8f83ce1)), closes [#3617](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3617)
* enabling web search for all ([b20510d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b20510dbcf52fd1104763acc208a27b9867b1b78)), closes [#3582](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3582)
* enhancing search tools in xyne ai ([907ee13](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/907ee132b3470c0731f795d8293a7f757af6f2ee)), closes [#3580](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3580)
* getting tickets that a user is assigned to and created by ([b357645](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b357645d7bdefb5f93a04d90db9d7c52853c19ad)), closes [#3395](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3395)
* Pulse integration with calls ([f27dd9c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f27dd9cc7ef95d9148f1d6adc332c7fc0a465205)), closes [#3577](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3577)
* removed the anchoring on leftAt ([0c523df](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c523df06582e799b965ab21be69eb34aa3e277a)), closes [#3581](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3581)
* Root Cause Analysis Panel ([cdd0b26](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdd0b26ce357d2af9b406af2de5dcf80fb693abc)), closes [#3539](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3539)
* Write access people can see the user group side bar options ([7436353](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/74363532c889a146a49ccd036ea51f2a1ae72a20)), closes [#3467](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3467)
* xyne-spaces support for windows ([7109746](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/710974696d4ed264812e9c06a08289ee2fc7cf65)), closes [#3415](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3415)


### Bug Fixes

* added required tracking ([3a01bb9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3a01bb9896cb398ccd8c0b2b32056a44dbd65424)), closes [#3645](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3645)
* change the editing workflow for quarto docs, and fix some workflow issues ([ab0b7e5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ab0b7e5f9c67fcbecf5cb1435e3aaf3962e45602))
* Default check to make sure created user is always invitedd ([508bd91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/508bd9143ee03caa840a4b7133a21114f3e7c404)), closes [#3660](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3660)
* draft fix ([f9a8ab8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9a8ab8ca0f0f05669f42c34fda505c3d355d619)), closes [#3586](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3586)
* fix call metrics ([2a083fa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2a083fa6891e67ebb1be4add628a8e9b8c08ac63))
* fixes settings tab bug ([d315858](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d3158586c0890f9eeea3026cb7e4ac59955068d4))
* fixing activity strcuture in the uii ([69f596d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/69f596d778a0340110b56bce6dbe98f2bfc35898))
* fixing the attachment skeleton coming small issue ([d72f3a0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d72f3a0f841ba89b590002329fe50a9a627baefe))
* fixing the blur video thumbnail ([5d9f80b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d9f80b65f9384635f188e941b0574f3769af240))
* logging web app boot duration ([1afda31](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1afda3117646542cbf5a033c93de0ff9ee14a83d)), closes [#3594](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3594)
* making user appear online on reconnect ([def80eb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/def80eb9a56be016aab93e4c5c33e4d7608c077e)), closes [#3572](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3572)
* modified the assignment logic so that QA wont get ticket assigned and PR eviewer cant be assigned to her/his  own ticket as asssignee ([e793f4f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e793f4ff5a309d414923e90a81d0827b30fc108e)), closes [#3609](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3609)
* one normal clicks open links in xs browser or cmd click open in default browser ([75b3f7f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75b3f7f04b2570ae6624b8307aaae1bb3901967b)), closes [#3576](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3576)
* open ask AI links in new tab ([1eb75d2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1eb75d2410c8f8e83d8157eca18cf5f24f264bd8)), closes [#3631](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3631)
* prompt name change ([2c53e12](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2c53e1260c49bf1346391dfa2b6eede6743f28d9)), closes [#3624](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3624)
* remove count of external messages ([5673695](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/567369548a4c9fc33617063f44bbc48b5c609262)), closes [#3607](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3607)
* restricted participant map to channel only ([1930c47](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1930c47b8a36d2f79dc86cbac112c76844c635fb)), closes [#3620](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3620)
* Upgrade blocknote version to 46.2 ([29d0e29](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/29d0e29edfbfce1038dc0aec9e497b7cc1c0795f)), closes [#3642](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3642)

## [1.58.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.57.0...v1.58.0) (2026-02-25)


### Features

* Fido workflow ([457779c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/457779c545f472dc18c69cf9cd66b5bf12015e1f)), closes [#3340](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3340)
* test automation ([3d4984f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3d4984f86f96eebdf89ca9dd6a067615d6ac7dba)), closes [#3570](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3570)


### Bug Fixes

* Hide 'All Boards' dropdown for projects with single-board ([bcc3fd3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bcc3fd3a030327cc63ee2db8622485da6f4dec7b)), closes [#3407](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3407)

## [1.57.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.56.1...v1.57.0) (2026-02-24)


### Features

* Add user activity tracking ([dd67c0e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dd67c0e803352b49702cd422a88d9053e6ed4b17)), closes [#2464](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2464)
* auto merge and unmerge tickets from zoho ([f5d5007](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f5d5007fc9616fac81ecac1c65bc13c99ba9a011)), closes [#3534](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3534)
* display_top_five_similar_tickets ([c3fe1fc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c3fe1fc3a14aada61ef0e49c8fe02499fd38db48)), closes [#3206](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3206)
* expose user activity via python query ([b108e2d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b108e2dca86d7ccdb1394429c58d4852aa794242)), closes [#3529](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3529)
* implements channel settings tab ([bfac520](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfac520d8a35171ff500bcfd563a797b9cc67173)), closes [#3114](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3114)


### Bug Fixes

* add user activity view in xyneai ([951932a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/951932a7c71c75aa830c599f6e7c9c7ad5bc9052)), closes [#3574](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3574)
* added a condn to handle isCallMessage sent in Xyne automatic ([9aa0ac0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9aa0ac054c64e4df15c691285d831a24bf30a01b)), closes [#3473](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3473)
* Added auto focus for search modal in ticket details and kanban ([4922d88](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4922d88eb73ea4bd30ce93759077ca882785d49d)), closes [#2492](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2492)
* build dashboard even when push images is true ([f0ec378](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f0ec37865b9fda1e61717cf7badb8f78837ee585)), closes [#3532](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3532)
* changing the stt_prompt to prevent transcript hallucination, adding missing env values and code transfer to bring main and deployed branches in sync. ([cb165fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb165fe806852e1cf7e963fcd2df699e9ef61752)), closes [#3511](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3511)
* fix the attachments coming blank when unsupported format is being uploaded ([f9dcb32](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9dcb325f498ac2912388c9ca82a13326f6f93f4))
* fixed call automation ([09aa67c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/09aa67cadf1e6027f87882667f3a4da7f98c37cb))
* fixing the count of selected stages on board switch ([b5552c0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b5552c004918113b0144e90b81e64eb388088349))
* move-browser-from-native-to-webview ([9ebb7bc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ebb7bcf2f45eba5407fe039dad8634d4f7b3dc7)), closes [#3563](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3563)
* showing error if permission is missing ([641f5e5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/641f5e59010583358793103e05be3f6037757fa3)), closes [#3519](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3519)
* stageEtaFix ([264ce1a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/264ce1a07d6fddfd579c1480088b830379397af3)), closes [#3242](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3242)

## [1.56.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.56.0...v1.56.1) (2026-02-24)


### Bug Fixes

* making avatar stack appear without white spaces ([5c2c63e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5c2c63eaa800d89ac66eb0d1c351987ac09edab0)), closes [#3525](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3525)

## [1.56.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.55.1...v1.56.0) (2026-02-23)


### Features

* Add user active status and resolve UI issues ([3e643ae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e643ae094b856473ad3aa2c826683a43c7a7d47))
* download transcripts ([8e01ea5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8e01ea5baff0b9f83ca6fc349e211afdbcd83312)), closes [#3336](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3336)
* Implement Scroll Behavior for Mobile Search and Resolve UI Issues ([79ab836](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/79ab8365593614ed95152647a7ecf7663a531ded))
* user mention in canvas call summary ([c9b7dbf](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c9b7dbf47b83e1f260f4e304638846910784411a)), closes [#3374](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3374)


### Bug Fixes

* : Added log if bitbucket auth missing ([964ca54](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/964ca544e83216db13681d6db72910216ab62082)), closes [#3490](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3490)
* draft mobile attachment preview fix ([3d35ea2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3d35ea29fd150b4372d75118cc726b1e4a6c7248)), closes [#3506](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3506)
* fetch nudge-extractor prompt from Langfuse with fallback ([457c0cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/457c0ccb9ddf2c9c8875814d9ba2b15ccd15500a)), closes [#3452](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3452)
* group dm count in mobile view and channel search in compose dm pannel ([c1dcc3b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1dcc3be14b6a42a796f61d18d6082e02749a37b)), closes [#3504](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3504)
* make-links-tab-backward-compatible ([0b6ced4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0b6ced4606521f5060a6ab9de13c4a01afa840f7)), closes [#3476](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3476)
* making avatar stack appear without white spaces ([ebc1aac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebc1aac7fcd513ba87a03b9dafa5f91895bc0044)), closes [#3507](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3507)
* search user with name and email and use a rich component ([b050fae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b050fae017e8253c109ca56aa4d9745968dcfac5)), closes [#3460](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3460)

## [1.55.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.55.0...v1.55.1) (2026-02-21)


### Bug Fixes

* Commitlint to work with both space and colon after ticket ([cb9d5a7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb9d5a7d340f8500a70f7c0eac09d0c3e315a4ab)), closes [#3483](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3483)

## [1.55.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.54.0...v1.55.0) (2026-02-20)


### Features

* adding keyboard navigation in the bulk images and files ([c7f1cc7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c7f1cc7ffd71e2d06b61fa097363ffab259cb0b5)), closes [#3270](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3270)


### Bug Fixes

* Add alias check in slack migration ([5de2d03](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5de2d034c4745f3c7ec12aefc704e3f87439461a)), closes [#3472](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3472)
* adding builder for analyzing and optimizing zero queries ([b4b1f44](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b4b1f44d061ec1c594a5e8451209420ea8118117)), closes [#3461](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3461)
* adding guidelines ([e1084d7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e1084d7d27358c815d971d4202bb8cfdcb6e8b2d)), closes [#3212](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3212)
* internal reroute for calls to prevent external routing ([7f70944](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7f709440dfcd9a050b053af4a53e55a413433ec2)), closes [#3326](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3326)

## [1.54.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.53.1...v1.54.0) (2026-02-20)


### Features

* youtube videos inline play and getting decription title for links in chat ([8c00575](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8c00575a38b873d2600bd37dc2927bb2376b01fc)), closes [#3301](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3301)


### Bug Fixes

* : revert "Pull request [#3018](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3018): Add interactive thread panel to web image modal" ([cdc91b6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdc91b63d407fe856812602f7eb4a9e1efbd977c)), closes [#3446](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3446) [#3319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3319)
* canvas fix where network issue where causing content to disappear ([cd2c8eb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cd2c8eb1e7f8b3c52fbf8e0ac565637d00129284))
* dummy script fix ([24765c7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/24765c7190abd351634c092c4e56f8d3b0f8aab3)), closes [#3449](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3449)
* KanbanBoard stage maker checker fix ([1b1629b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1b1629b3184e437c4a8ec73a2173013374bf9d06)), closes [#3154](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3154)

## [1.53.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.53.0...v1.53.1) (2026-02-20)


### Bug Fixes

* added pr title validation moved release steps ([4a3f9c8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a3f9c8237873dc9b9b74d1598b69eeb58d2162c)), closes [#3442](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3442)
* call notification  mobile ([2ee7f6f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2ee7f6f678f949fa23b328e5960162ff6d5e4669)), closes [#3448](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3448)

## [1.53.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.52.0...v1.53.0) (2026-02-19)


### Features

* enhance Bitbucket integration with PR diff retrieval and workflow message updates ([950e58b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/950e58b232fcc37b1d9065d3839cd8eb4b6b0a8f)), closes [#3255](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3255)
* moving to native call and metric ([00fe264](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/00fe2642367f6afc155999d7be21889f2a6ad96c)), closes [#3333](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3333)
* trigger worklfow with pr comments on bitbucket ([8ec4110](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8ec4110423962015809a5fc70f85bf28eed90ed1)), closes [#3421](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3421)


### Bug Fixes

* Fix empty user tagging list in DM Panel ([9ef4ae4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9ef4ae4c026cefa75da3da986acc06789cee5087))

## [1.52.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.51.0...v1.52.0) (2026-02-19)


### Features

* local automation test runner ([1ea3224](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ea322413a9eaa6525f4954e76458075787e95b7)), closes [#3329](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3329)
* workflow questioning ([473215c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/473215c08fb4ce7e19809b652ae1ec4660e5d015)), closes [#3275](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3275)

## [1.51.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.50.0...v1.51.0) (2026-02-19)


### Features

* call validation cron job ([b88f91b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b88f91b386ffa4253544de60c88243e7c0c81ff9)), closes [#3396](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3396)
* One click setup script+dummy seed ([442faf6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/442faf65bba91329a0823d84dddf7c5bdc4be1e2)), closes [#3287](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3287)
* stage level eta overdue filter ([1e5be1e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1e5be1ee691471b8d8b8513ae80e72ac1dcae3f4)), closes [#3282](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3282)
* test automation ([e450140](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e450140f82bd23c46722b77d95dea678a3573984)), closes [#2954](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2954)


### Bug Fixes

* Cancel option to DMs Header search input ([4af7177](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4af7177258de09b64e8440814d9193f3fcd61b52)), closes [#3269](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3269)
* channel call notification fixes ([874f928](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/874f928887cd3228407fbc6b36cf0c89f3b824c4)), closes [#3383](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3383)
* Display participant count in sidebar DM header ([dcb1bd8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dcb1bd87f1991fa3c8dcc6db7a64b8f382f545b4)), closes [#3265](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3265)
* making board name unique per project and making all proj visible to all ([17411c8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/17411c8b432803a4744dbb3bac270e304eebd73b)), closes [#3368](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3368)
* pdf resizing and text attachment bg fixed ([a9ff797](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a9ff797d47a9fec2438d2bafe6d06986019f45a2)), closes [#3319](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3319)

## [1.50.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.49.0...v1.50.0) (2026-02-19)


### Features

* add co-author in workflow commits ([3e36555](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e3655501997200dd507cf10e5f3ecf778b88c27)), closes [#3298](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3298)


### Bug Fixes

* only-on-empty-input-enabling-keyboard-shortcut ([076e2c1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/076e2c120dbf8552492c07620ac4bca88ca8f71b)), closes [#3373](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3373)

## [1.49.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.48.0...v1.49.0) (2026-02-18)


### Features

* added logs for unhandled events in roomMachine.ts ([f1ff572](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f1ff57247a21ce954a412533c716856c8ca292df)), closes [#3327](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3327)
* admin can add, remove or modify user groups ([27dc4f8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/27dc4f8d5e19c6a005b2e1b12609d517728e7274)), closes [#3353](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3353)
* Draft attachments and synchronization ([53c39c7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/53c39c7d0c67565bb622ee8904a6e97318745225)), closes [#3117](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3117)
* Grant developer admin access to all local resources ([c0f1976](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c0f197676f0c68097ffbae30389236cb24b633a5)), closes [#3296](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3296)
* stage eta reminders ([7250d86](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7250d8625f191f46dce0d21f722010cf41c536b7)), closes [#3208](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3208)
* user Online offline Away ([2e33293](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2e33293a907f20d80300d544fae0a0209a19e104)), closes [#3115](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3115)


### Bug Fixes

* All Boards filter not working ([a861837](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a86183745653882a85c8bb31b4a8bac3e3e64d44)), closes [#3308](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3308)
* Disable lazy connectors in Redis configuration ([5d930f0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d930f0911a912923db262238a9529360df24c78)), closes [#3338](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3338)
* screen share scale issue fix ([0ed57b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0ed57b95a93cc9c87d935154915a08109cd85b96)), closes [#3367](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3367)

## [1.48.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.47.1...v1.48.0) (2026-02-17)


### Features

* livekit webhook implementation ([88e66cd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/88e66cd850305b91609958d1900c83ba50931d97)), closes [#3052](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3052)
* seting lazyConnect as false for worker ([4c65043](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4c65043f4138153b0e8e355e0e0167feb8fa0151)), closes [#3331](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3331)


### Bug Fixes

* custom-emoji-rendering ([dc8d9bc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/dc8d9bc0362048ca1c534f420b44a9c5fd37cd41)), closes [#3307](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3307)
* Mobile view Profile Drawer ([984b711](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/984b7115c6914e2b194d93ae57a3f2d4cf2c627c)), closes [#3081](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3081)
* workflow fixes ([bd80c72](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bd80c72a4c9585a41615d1ef885d2e91633c9fb5)), closes [#2546](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2546)

## [1.47.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.47.0...v1.47.1) (2026-02-17)


### Bug Fixes

* Log detailed JAF error in agent stream ([75d1a40](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75d1a409fd8ec731724ac592f063e4f293a46932)), closes [#3283](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3283)

## [1.47.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.46.0...v1.47.0) (2026-02-17)


### Features

* added mark as unread for my msgs, attachments, stopped scroll ([d784fbe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d784fbec518688bab6a6adc3b965f48daeeca4e9)), closes [#3300](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3300)
* paused eta projection ([1dcca2d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1dcca2d7a3d41c4e4f7c6fec7b37cadefb36b891)), closes [#2826](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2826)


### Bug Fixes

* Added  masking in langfuse tracing ([80d2e34](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/80d2e34976457e21e27bee1c48a5f73987fa2e8b)), closes [#3245](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3245)
* fixed admin resource acess in automation ([f7adb21](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f7adb21f0cfba35558e8814df0151b31253bd0b3))
* ip box new line fix and redirect on @ mention ([38a7181](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/38a7181a46de19b23eb83e226b9f6fd34428952d))

## [1.46.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.45.2...v1.46.0) (2026-02-17)


### Features

* added drawer to view chat reactions on mobile ([f520850](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f520850a491531be23cc380dadb522977ca135db)), closes [#3179](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3179)
* User Management System ([fdebafd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fdebafd36c83482cab985d627df125adde112828)), closes [#3055](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3055)


### Bug Fixes

* Add query_source and is_modified properties to search events ([0f8aac7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f8aac7f26fc788fb0bf0ccb610232a717259323)), closes [#3236](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3236)
* edited automation timeout to 45 sec and retries to 2 ([71b862d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/71b862d85fb0f62ebebb5aaf27f95cd242f78f58)), closes [#3243](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3243)

## [1.45.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.45.1...v1.45.2) (2026-02-17)


### Bug Fixes

* Last Activity At should not update for thread replies ([cb11a48](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cb11a48958c95209cd374fc066cf40a1c30ae1a9)), closes [#3247](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3247)

## [1.45.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.45.0...v1.45.1) (2026-02-16)


### Bug Fixes

* updating zero to 0.25.12 ([565bb2e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/565bb2ec0ae7cb657085b1ce77942768b6b6652f)), closes [#2796](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2796)

## [1.45.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.44.3...v1.45.0) (2026-02-16)


### Features

* added page fields in logging and corrected version ([9b8fc91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b8fc91299bb0c772704da3dd095d80ad46e38c6)), closes [#3278](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3278)
* proactive nudges (create ticket only) ([a963841](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a96384133ece73e90c770f38fe11273c62cc047a)), closes [#2759](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2759)


### Bug Fixes

* fixed CPU issue for agent ([db25665](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db25665eaeca7a2250e853a32c5d3a6f1a1f2db6))
* ios double notification fix ([852b077](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/852b077d5018ad1a766fbb363933786812310b2d)), closes [#3155](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3155)
* Queries for ChatListV3 ([5769545](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5769545abfa078def0f1c5d3e3babb1bc9cd5c35)), closes [#3262](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3262)
* rendering-fix ([6819fba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6819fba8a1bc29017a356a091fb3364eed4f272a)), closes [#3263](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3263)
* update webview bootstrap script to handle bundle error ([e317077](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e317077076674b5133528a097b525d25766952ae)), closes [#3231](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3231)

## [1.44.3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.44.2...v1.44.3) (2026-02-16)


### Bug Fixes

* added feat/fix: ticketId format for title validation ([ebdb915](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebdb91539f7a5becb5ff290f754ab7afa5a86deb)), closes [#3180](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3180)
* changed automation to match recent ui changes ([db5d895](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/db5d895fb6d0bad63ff3e1994713d6a9601dfbcd)), closes [#3229](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3229)
* fix search logs structure ([efeca5c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/efeca5c51f149e448229d302668583d0cdf37536))
* Fix the video attachment ([3e00d3e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3e00d3e189d4cb02a61f85bed74cd71ede44b8fe))
* improved chat dm exp ([718750b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/718750bc3a5a6bd0472dc3a398e067001edd55ea)), closes [#3057](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3057)
* kanban board filter header overflow responsiveness ([0bbd134](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0bbd13483e76abefc3778f15873d2f170f7fbb97)), closes [#3170](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3170)
* safe area view fix ([123d41b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/123d41bc9eefda41d7f31e1be9220762bba2b274)), closes [#3162](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3162)

## [1.44.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.44.1...v1.44.2) (2026-02-15)


### Bug Fixes

* Fixed broken ticket navigations in mobile ([ee86e39](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ee86e396bc6a3c914e49d1388fd7ab1ed39cc8b1))

## [1.44.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.44.0...v1.44.1) (2026-02-14)


### Bug Fixes

* handle mtls post auth, have log level string type instead of number ([16b2ad0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/16b2ad07711a8951afe1e8e29b15557dfc040e02)), closes [#3186](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3186)

## [1.44.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.43.0...v1.44.0) (2026-02-14)


### Features

* : Feature/context service implementation ([366a9ab](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/366a9abcb95766c50fb21cde76dbf875d17b4064)), closes [#2951](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2951)
* Add more Ask AI metrics ([c2c72df](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c2c72df10e6e51a5f6f7dc4de7cbcda2291c5275)), closes [#3157](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3157)
* capture relative to  dashboard path in linters for useQuery and uzeZero ([4a5964b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4a5964bc725b7f07216a4f287b7cfe5a9da13fe7)), closes [#3158](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3158)
* handled new msg indicator for back to channel from other route;added mark as unread ([d61476a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d61476a06eb55f534a517a84a6c0664b607abc7f)), closes [#3112](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3112)
* Implement recent DMs feature un UserProfile ([7e03787](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7e03787a9611f18283a6233538180edc63eca282)), closes [#2816](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2816)
* testing webhook with logs ([249d29a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/249d29a767211bd1a4e814ac0ae9eeee436565e3)), closes [#3102](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3102)


### Bug Fixes

* Create Dm Panel useZero import fix ([2b4b8f8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b4b8f8c5628714838bafdefb82d66caebbb1fff)), closes [#3151](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3151)
* fix ticket navigation in command k ([cbe4e87](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cbe4e87675751430bd4fd74bd338a3f759be7942))

## [1.43.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.42.0...v1.43.0) (2026-02-13)


### Features

* Create Dm Panel with shortcut cmd+n ([cc75240](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cc75240254234f09c2f477d12fa47003112ad0e3)), closes [#3030](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3030)


### Bug Fixes

* added backticks validation fixed rendering of Text [XYNE AI] ([3412d38](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3412d38e578feb31e5cb8e6d21872ed6285be3b9))

## [1.42.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.41.0...v1.42.0) (2026-02-12)


### Features

* Added meeting summaries in thread using sam api ([a1f1c33](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a1f1c33b7fcdbe5ab52ced1c953ea5f4161d8d46)), closes [#2753](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2753)


### Bug Fixes

* fixed ticket automation timeout issues and optimized ticket creation scenarios ([e210583](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e2105838e9ad4adabf050f1b631e91bd3192678e))
* stageformModal linting fix ([a504ff4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a504ff4714d846adf397a07fe962e78682106c3f)), closes [#3101](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3101)

## [1.41.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.40.1...v1.41.0) (2026-02-12)


### Features

* : Added attachment support in xyne ai ([fca8508](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fca8508e15ca4df5012d679b92e9ca85119ace17)), closes [#2477](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2477)
* Add ticket search as filter ([2efd374](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2efd3741f45d8261f2e18169e9911dc86801558d)), closes [#2982](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2982)
* stage maker checker ([6760796](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/67607963d090aa10c10d2af2e05f3753e3e5c5df)), closes [#2732](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2732)


### Bug Fixes

* Removed expanded ticket view for mobile cases ([ea8baa2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ea8baa27f7dcfe9025ec9e6538d21306b3408011)), closes [#3062](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3062)

## [1.40.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.40.0...v1.40.1) (2026-02-11)


### Bug Fixes

* reducing workflow execution table ([186e8b0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/186e8b030eb48cba52dea30293ef588ca71e91b0)), closes [#2968](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2968)

## [1.40.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.39.0...v1.40.0) (2026-02-11)


### Features

* Added Wrapper Function for useQuery() and zero.mutate() ([3b2767c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3b2767cbdaec9334ce8aa436b5b5ef4fef3bce90)), closes [#2860](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2860)

## [1.39.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.38.1...v1.39.0) (2026-02-11)


### Features

* added input box filters for mobile also ([10dcd59](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/10dcd59d44fe5c0756b0bde260085af5c3f35c6e)), closes [#2946](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2946)

## [1.38.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.38.0...v1.38.1) (2026-02-11)


### Bug Fixes

* Added env for default executor ([37d8600](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/37d8600b2e899afccc61eaf3496a09f81df847e6)), closes [#3037](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3037)

## [1.38.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.37.0...v1.38.0) (2026-02-11)


### Features

* add retrieval for attachment search ([e6f7beb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e6f7beb9b1e1a294d0f25f809dcab770cf660136)), closes [#3035](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3035)

## [1.37.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.36.0...v1.37.0) (2026-02-11)


### Features

* call issue fixes ([6b29dd7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6b29dd79d0c28d107b62191c3899a3bbd292f516)), closes [#3029](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3029)

## [1.36.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.35.0...v1.36.0) (2026-02-10)


### Features

* custom summary generation flow ([2f9cf1b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2f9cf1b4bcbc6d19601cc5feed48778e9d4c5f09)), closes [#3027](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/3027)


### Bug Fixes

* adding new models ([2419c3e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2419c3e2a4dd552659f45dfbecd6e23038ecc01e)), closes [#2851](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2851)

## [1.35.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.34.0...v1.35.0) (2026-02-10)


### Features

* add endCallForAll ([24269c1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/24269c1d4bc1cb7d301bff1647622f9408bdee66)), closes [#2769](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2769)
* Add system call forward feature ([9a9bc87](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9a9bc87bd38ec5ad9a2fa8047a42ccc2eadde6ef)), closes [#2862](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2862)
* added automation to create sub ticket and status change in ticket ([0118f4d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0118f4d23f23d3a213523fede077e82003a05836)), closes [#2704](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2704)
* added callId bsed individual logs for the end to end flow ([2093927](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/20939275822efb5f56f3f61258f04d2ac430e16b)), closes [#2715](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2715)
* added dropdown for filtering using channel in support (xyne-desk) ([4b14031](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b140319ed59497c3dc3f8653e6b541f478f362c)), closes [#2828](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2828)
* added PRD-Modal, made changes to controller to accept custom instructions ([f9fba8c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f9fba8c19252dd1c847fb4aca635aa9650fbcd50)), closes [#2864](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2864)
* update bundle when new version is available ([7769aac](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7769aacb6f14301e1bbde0200acab998b144d1bc)), closes [#2780](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2780)


### Bug Fixes

* fix the chat jumping and flickering sometimes issue ([a37ec02](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a37ec02504b2f1f4131ff3f5eeac015deb7276ff))
* fix the code block gettign empty ([267c0ea](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/267c0eac6bded176b941dde8194e7c698d088708))
* Fix the link insertion ([5d3b430](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5d3b43009012959655f36ba4ee07e84d455db58a))
* fixes bolding of channel/DM name ([2d82f25](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2d82f25a560f20fc9c58b2276fbe31a1ceab4fe1))
* Fixing the activity links getting cut ([2f642f8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2f642f89169a779b2861022dddf8cb94fc227508))
* Make canvas collaborative by default ([a9b5fbd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a9b5fbd8ca816e235293357162693f6adda97e3d)), closes [#2908](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2908)
* Pagination for tickets table ([7167c1e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7167c1ea313a8f707998eda313aa8e7ada7e3e84)), closes [#2948](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2948)
* restrict CALL_DISMISS notifications to mobile only ([919ff1e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/919ff1ec1b00226d454406162028f961375b6f39)), closes [#2855](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2855)
* Show Avatar after a system message ([0eec763](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0eec763bf3df60d625e8fae0d701fadccd51ef5b)), closes [#2875](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2875)
* terminate worker process when workerscheduler fails to start ([7a79172](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7a7917263def0004c37ea0e9f72b17cdf620eaa3)), closes [#2941](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2941)
* Ticket Details bugs + removed expanded view for mobile ([ebe9f40](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ebe9f403fbb70740957ded91da3608cbc49ed3fe)), closes [#2481](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2481)
* XYNE-5505 XYNE-5502 fixed mobile bugs ([b7e6c3f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b7e6c3f55ef148236cf8f2d2974f558fdc81d5cd))

## [1.34.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.33.2...v1.34.0) (2026-02-09)


### Features

* ticket PR and QA assignee activities ([efcaa8b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/efcaa8bd51053a018f23bdbc79bb3e79677552fa)), closes [#2891](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2891)


### Bug Fixes

* Disable Langfuse tracing for ASK AI ([1168d30](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1168d30c64415aab36f8440ac7036e3c35d8a2be)), closes [#2917](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2917)
* fixes suggetions list scroll bug ([baff4dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/baff4dcabb3939561629d94a8f70a0831ee21d05))
* timezone fix in search ([2e5338e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2e5338e29846072aae44d2c263a93a34bbca3b2c))

## [1.33.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.33.1...v1.33.2) (2026-02-07)


### Bug Fixes

* readding transcript ([cf8061c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cf8061c1db3f6ac3037fc7c179fe664518b746ce)), closes [#2900](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2900)

## [1.33.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.33.0...v1.33.1) (2026-02-06)


### Bug Fixes

* login issue fixes ([811bf7e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/811bf7e5f9b1f9593431286829257edfbc421a1e)), closes [#2787](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2787)

## [1.33.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.32.0...v1.33.0) (2026-02-06)


### Features

* added boardId in external source schema ([af82511](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af825118b431c16ee314bd70de52b56663d03541)), closes [#2885](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2885)
* added call automation ([879ce3b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/879ce3b2f5703733a41c59c0103cadf99ab5c4a2)), closes [#2453](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2453)
* added phone number, dob and team edit thing ([c649977](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c6499777f97e7a2fde2dc1e53a689b341e77348d)), closes [#2380](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2380)
* Repo and Product context support in Ask AI ([f8058e6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f8058e681c7c3e72f2b6a60632efd362f52017bf)), closes [#2785](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2785)


### Bug Fixes

* Fixes for quarto publish and new doc creation flow ([eb59846](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eb598465a6c1a73432fa92e0e26222d8f46e7154))
* joint emoji fix ([54dbc92](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/54dbc9229edd5b26d1e36cb0a7d0f10a6a1b4199)), closes [#2863](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2863)
* manager notification on resume and z-index fix ([f16caeb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f16caeb711180ac0597c5f736ee63cf53d182c39)), closes [#2835](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2835)
* rate limiting for zero queries and mutations ([6aae969](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6aae969b15689fa0ad1a1e249d56dfc40878795e)), closes [#2654](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2654)

## [1.32.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.31.0...v1.32.0) (2026-02-06)


### Features

* handle drawer state via native bridge ([b32a67e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b32a67eeb712400b25c5c3ddfde8d0ed8fb21c87)), closes [#2847](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2847)

## [1.31.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.30.1...v1.31.0) (2026-02-06)


### Features

* added_websearch_tool_for_Xyne_AI ([38c4191](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/38c4191e7555d9df619721a82e81492aeef9816d)), closes [#2786](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2786)


### Bug Fixes

* removed db upserts for user presence status, cleanup cron and heartbeat worker ([13f33fd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/13f33fd002510355855a62bb41687394d9cd4a91)), closes [#2806](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2806)

## [1.30.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.30.0...v1.30.1) (2026-02-06)


### Bug Fixes

* call summary and forward msg copy fix ([12a8aa4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/12a8aa41dbb8fb68f031a14eaff9e8b55ee38032)), closes [#2831](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2831)

## [1.30.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.29.0...v1.30.0) (2026-02-05)


### Features

* fix search summary ([1c08396](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1c08396e752d20f74def084e5e075053bfc1c324))

## [1.29.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.28.0...v1.29.0) (2026-02-05)


### Features

* Add matchFeature in debug info for grouped vespa search ([4080d4b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4080d4bf7cde997f7af2096d2664897b5e1f7cde)), closes [#2747](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2747)

## [1.28.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.27.0...v1.28.0) (2026-02-05)


### Features

* removing tracers from activityClassification ([9683e82](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9683e82282a6c86489efb4b40f2be1860c981604)), closes [#2808](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2808)


### Bug Fixes

* fixed multichannel selectdropdown [XYNE AI] ([49373e0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/49373e083acd51e80aba219a3c88307f2615142f))

## [1.27.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.26.0...v1.27.0) (2026-02-04)


### Features

* add ticket assignment availability ([7fadd83](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7fadd8331ffb9a9bd49e3c63237c36b2ee370718)), closes [#2694](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2694)


### Bug Fixes

* add more metrics in search ([52ee42d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/52ee42d03a85ffdde9c938664f9fc059a37e0d8b)), closes [#2716](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2716)
* Fix navigation button colors on call participants screen ([1dff9d2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1dff9d276b59f4400eb3c73bafddf044d4f9e91f))
* stop trying to send logs in local environment ([28a36d6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/28a36d65bb152eb0cbd09e1fa3e0216f34ed0366)), closes [#2682](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2682)

## [1.26.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.25.0...v1.26.0) (2026-02-04)


### Features

* changed the prompt to prevent leakage ([b874990](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b874990b33f7ffaa693280bb4052d260bab475a3)), closes [#2721](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2721)
* enhance validation workflow with error fixing capabilities and maxTurns support ([c1df1d2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c1df1d27d5b291364767514ced8133a426adf62a))


### Bug Fixes

* added no cache ([fa93f19](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fa93f19897c76a178f58335879dcbc11d738a0da)), closes [#2754](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2754)
* ios double notification fix, add force update for ios ([bb05d91](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bb05d914f8407a27c1c667633b49bfc6952d0c5f)), closes [#2446](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2446)

## [1.25.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.24.1...v1.25.0) (2026-02-04)


### Features

* making zoho workflow env based ([9e8c16d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9e8c16d3c0df09976c5dc967738f40c418b36dc0)), closes [#2738](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2738)


### Bug Fixes

* fixed queryBuilder mutator ([6d88965](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6d889657de1a1d909614b62111b03b752fb5d386))

## [1.24.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.24.0...v1.24.1) (2026-02-04)


### Bug Fixes

* online indicator position fix for sidebar and chat list ([fe61854](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fe618544d9ab241ef1e3fc355b3e19da41dd53b9))

## [1.24.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.23.0...v1.24.0) (2026-02-03)


### Features

* add participants icon to show the list of participants in call ([eacf2f2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eacf2f2114f2afa832c58c136182605dd226eccc)), closes [#2669](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2669)


### Bug Fixes

* correctly parsing html for copy message functionality rather than plain text ([e18ae78](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e18ae78415903e36a0e7523a136b406221282222)), closes [#2709](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2709)

## [1.23.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.22.0...v1.23.0) (2026-02-03)


### Features

* command trigger regex fix ([cce9a59](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cce9a5935006fdffb3d3f876129e962ca7eb1c6b)), closes [#2497](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2497)
* Fix KanbanBoard drag and drop ([5bf9f83](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/5bf9f832c4e0a94c6cd2dbeea720fa732fa17455))
* removed version import ([26299a5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/26299a57824703048b44ee40fbc1503dde7daf41)), closes [#2666](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2666)


### Bug Fixes

* Fix filter retention ([26a9267](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/26a926745b6c0a274164979d18b1fbf591c000be))
* Fix ticket search loader movement ([8562b0c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8562b0c0a70a9c3e1b7316bf8a27f0bf6922fa7a))
* platform issue for smaller displays ([34dfd1a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/34dfd1a40c78efa39f9c2559c5d5318c77516fe9)), closes [#2703](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2703)
* replace user_email with user_id in search metrics ([74fd175](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/74fd1759c7b88b1166ec879bc8e2fa79dadfd46a)), closes [#2689](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2689)
* swipe back bug fix ([7ebc102](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7ebc10242768bcdcfa30365fa3f51480e3f0c5eb)), closes [#2537](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2537)

## [1.22.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.21.1...v1.22.0) (2026-02-02)


### Features

* Added Ask AI metrics to Grafana ([22d916f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/22d916fd83cdd07ec0e7d3c7bd6a7e4ed504580b)), closes [#2489](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2489)
* added schema public to new tables to fix builds ([54207fa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/54207fa15b77ee713e9b04b80b4ac2695fbfc653))


### Bug Fixes

* Fixed removing listeners only on socket disconnect ([50633dc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/50633dcf58f5872a2bab093587f4673d4d69da08))

## [1.21.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.21.0...v1.21.1) (2026-02-02)


### Bug Fixes

* add logs on app focus and blur ([4ae6feb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4ae6feb4e9d4a02f299ddcbb0c0359d550dbf38f)), closes [#2634](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2634)
* handle certificate revoke errors in electron ([f2d22aa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f2d22aab006ef82538e8e58bfbb51e36b5ec0911)), closes [#2588](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2588)

## [1.21.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.20.1...v1.21.0) (2026-02-02)


### Features

* changing schema ([e84e096](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e84e09614ffe3fd2ff19009eb6cba388db567454)), closes [#2557](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2557)
* Fixed config values ([4cc6860](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4cc6860bc9e22afccc2ab99220dc198d670f5e55))
* Implement ticket search in kanban board view ([7be2af8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/7be2af8a69531c7b200db9b791d18252873f5267)), closes [#2308](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2308)
* logging fixes ([1ed3b3b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1ed3b3b303ee08b311793855c33ca6056e8b6954)), closes [#2511](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2511)


### Bug Fixes

* Add user id as dimension in Metrics ([d0ca94a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d0ca94a7f15ebcae4e34760d883653f489db6d8d)), closes [#2510](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2510)
* added the global package into the test docker containers ([b5c1707](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b5c170761545773918071f56108d04e176e5c939)), closes [#2629](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2629)
* exclude system messages except ticket ([349aba1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/349aba1a03d8ef41050c24a2df9b9cc78a42d226)), closes [#2567](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2567)
* Fix redundant socket connections on channel switch ([1f6a077](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1f6a07711b100d5dfa721cfb300a8a2bede46abb))
* fix route for detailed ticket view in search ([a03667e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a03667eafa46c15dd1f234c863c15c483302cb29))
* fix the bookmark bug ([60a34f7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/60a34f7969ea7131c6ff87eb5f38837743d7b9dc))
* Fix ticket ETA activity notification routing ([234b106](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/234b1069bdb76c1a6f5f54519fa04e1272169cbf))
* fixed the logo signature ([d39c7b5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d39c7b5c2d4dbd461e7ebda2b1e5e52670ea6690))
* fixed xyneAI tracing ([02c2367](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/02c236728bef525d1d50dfb4d367ddced90a06d0))
* Groupdm not coming in dm search in mobile ([6c6a847](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6c6a84722e7f910b6d234481ce5d72f08b069e92)), closes [#2507](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2507)
* reload on zero error automatically ([de3f598](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/de3f598d52afa340759f41db041ff6dec81aa6f3)), closes [#2568](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2568)
* removed abs positioning of callControls buttons ([bfee13d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bfee13dc11f6bc20d99ecc72e1308e212f0eb748)), closes [#2531](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2531)

## [1.20.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.20.0...v1.20.1) (2026-01-30)


### Bug Fixes

* Fixed CmdK Menu People onclick navigation ([1785dce](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1785dce2a15f8a278b06b2236d85056290db7a49))
* Restored old backend links ([c25f71d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c25f71dc147a754da9931387ac953add54c1801e)), closes [#2522](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2522)

## [1.20.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.19.1...v1.20.0) (2026-01-30)


### Features

* fix build ([657069b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/657069b4fd56e54176ee54d7e20732f81a9eb7ac))

## [1.19.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.19.0...v1.19.1) (2026-01-30)


### Bug Fixes

* separated the systemPrompt and the userMessage to better handle the response from LLM ([6885ada](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6885ada1e6003f62a54b413190ed49ec9cd5f49f)), closes [#2506](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2506)

## [1.19.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.18.0...v1.19.0) (2026-01-30)


### Features

* handle missed call and dismiss ringing notifications ([c49f6ff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c49f6ffc105265dd893df2201310b6a71db318ca)), closes [#2469](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2469)

## [1.18.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.17.0...v1.18.0) (2026-01-29)


### Features

* adding formatting for backend logs ([6eeec7c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/6eeec7c7cefed8bb8deb766dacaeb422c5c8ae4a)), closes [#2269](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2269)
* migrated backend console logs to logger ([8a7aef8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/8a7aef8a769c678c724fc69dab23b8445a18cfc3)), closes [#2490](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2490)

## [1.17.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.16.1...v1.17.0) (2026-01-29)


### Features

* enhance Bitbucket integration with latest commit retrieval and diff parsing ([3269f21](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3269f2198efd2d8625acf8e64ff3744c99608abd)), closes [#2257](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2257)
* Implement Comprehensive Metrics & Monitoring for Call Notifications ([d9bc625](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d9bc625a140fff1c1446ed002c1d01668a2f9f26)), closes [#2335](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2335)
* metrics, loggers pre-mtls-enrollment ([479af83](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/479af8379e9d7341a6df85fe8cc836131bf37966)), closes [#2293](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2293)


### Bug Fixes

* docker build issue fix ([ee8f5a9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ee8f5a926c952657ab8f4b02e2121a39a7e377ab)), closes [#2371](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2371)
* fixes forward msg mobile view bugs ([920c401](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/920c4012f9213931747352b92a7717b879740b14))
* fixes forward msg mobile view bugs ([4b573be](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b573bec0c64edc332894c8889f04097d3d56222))

## [1.16.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.16.0...v1.16.1) (2026-01-29)


### Bug Fixes

* adding_feedback_support_for_xyne_ai ([d364f77](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d364f779367c110c39e5b07baf86c8c3a1145f92)), closes [#2447](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2447)

## [1.16.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.15.1...v1.16.0) (2026-01-29)


### Features

* enhance workflow polling with active execution management and improved slot filling ([c592c75](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c592c75afe792f08e484a4849fde10bfcc315b62)), closes [#2434](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2434)


### Bug Fixes

* added prompt param to create_stt ([ba38fae](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ba38faec7416d40ad41211ff7a733096da752c25)), closes [#2438](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2438)
* Fixed ETAActivity navigate ([ccde34c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ccde34c07cfb8a2157d12ef0c9b9e5d14fd994d1))

## [1.15.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.15.0...v1.15.1) (2026-01-28)


### Bug Fixes

* call message not working for channels ([077e4f8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/077e4f8cf7ec493324bdd822b4802efa41731abf)), closes [#2419](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2419)
* filtered ticket navigation fix ([3af322c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3af322c8af46d44e8ab168d983875ce0acd579e7)), closes [#2398](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2398)
* fix the my tickets view ([236a6bd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/236a6bda6c46efd5761a98333685526b088f7ca6))
* fixed on forward msg notification working ([73b70ef](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/73b70efa12c22e41f234118e4db937524c0ea35c))
* Minimise button not redirecting to origin for my tickets section and project->board->ticket ([eabbe83](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eabbe830ddc88fb95c3d0c496c08e91094d1d810)), closes [#2365](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2365)
* mobile rotation navigation fix ([e5cc058](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/e5cc05844414b856bf7a5c3628e559a0564425b1)), closes [#2414](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2414)
* Redis TTL + heartbeat + grace period added for User Online Presence,with frontend ([1a3e695](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1a3e695f1694ce348de837790c8b50b9b20b5403)), closes [#2364](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2364)
* sandbox fixes ([537a5df](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/537a5df0964a34b4f306b1142dcd0ee8a8882f0d)), closes [#2412](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2412)

## [1.15.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.14.0...v1.15.0) (2026-01-28)


### Features

* Added Multi-channel search with FVD validation for channels and user context ([b29996d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b29996d147fc03c28973c94a23380683e6fe2987)), closes [#2384](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2384)

## [1.14.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.13.0...v1.14.0) (2026-01-28)


### Features

* give user the field to pass the branch/commit to checkout from in workflow ([4b67b53](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4b67b53587480bffc0b4b3e41f481c6ebd452dc9)), closes [#2349](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2349)


### Bug Fixes

* drag drop fix in ticket view ([17df857](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/17df8578ddf6367940e42e5c68ac10ce45da5419))

## [1.13.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.12.0...v1.13.0) (2026-01-28)


### Features

* add cancellation support in the workflow ([0c7ed42](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c7ed427d8b4515244e4dcd76afd0eef5be95172)), closes [#2355](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2355)
* added refresh logs ([879052c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/879052c65d514f780c90d4a238cc4b957df7ebfd)), closes [#2306](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2306)

## [1.12.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.11.0...v1.12.0) (2026-01-28)


### Features

* Workflow Trigger Modal ([bc03982](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bc039823f9e411fd4335520f1258954952c39e23)), closes [#2224](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2224)


### Bug Fixes

* fix ticket navigation ([b2fb2b9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2fb2b9edb2307031b8b04e958ac90fd2397a697))

## [1.11.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.10.0...v1.11.0) (2026-01-28)


### Features

* related-sub ticket section replace, Font fix ([f0be38d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f0be38d9f381b9d2ebc8a6d6bc7a4892157e14bc)), closes [#2377](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2377)


### Bug Fixes

* padding fix ([9f6daf5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9f6daf5f196c1e1798183ebaf4474078b6f74ab1)), closes [#2376](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2376)

## [1.10.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.9.0...v1.10.0) (2026-01-27)


### Features

* message and call in profile ([d42f33d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d42f33dd306a9c114eef40b5c600bfe65d8c91d4)), closes [#2300](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2300)

## [1.9.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.8.0...v1.9.0) (2026-01-27)


### Features

* Allow editors to add participants to canvas ([57e6751](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/57e67517ae12eb1ba6e7a05c130bfc0e24dc6d8d)), closes [#2323](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2323)

## [1.8.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.10...v1.8.0) (2026-01-27)


### Features

* ADD_TICKET_CONTEXT_TO_XYNE_AI ([362b394](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/362b3942d832b87d737d7beb6cfeec3691b6c8d8)), closes [#2305](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2305)

## [1.7.10](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.9...v1.7.10) (2026-01-27)


### Bug Fixes

* Fuzzy parameter fix ([f08a1fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f08a1fee82fe0edb9ba36c956abd8fac4eb754f5)), closes [#2311](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2311)

## [1.7.9](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.8...v1.7.9) (2026-01-27)


### Bug Fixes

* fixed threads mobile and canvas access from chat/dir/canvas ([37f7eaa](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/37f7eaa824b32d759a29f34524351e36107859ad))

## [1.7.8](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.7...v1.7.8) (2026-01-27)


### Bug Fixes

* Implement full screen view for canvas thread panel ([0498565](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/04985657ca58f5b36ffad957ea423fe56e9cff08)), closes [#2302](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2302)

## [1.7.7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.6...v1.7.7) (2026-01-27)


### Bug Fixes

* fix branch checkout logic for quarto docs ([d10fb00](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d10fb0083e96de6c6d8060e8ad282e75949af79b))

## [1.7.6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.5...v1.7.6) (2026-01-27)


### Bug Fixes

* Remove UUID and Date.now from mutators ([af74d0e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/af74d0eca2954c906b7fed4b80aea35f0b5a01f6)), closes [#2333](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2333)

## [1.7.5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.4...v1.7.5) (2026-01-23)


### Bug Fixes

* Cached conversations deletion ([b9c841a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b9c841a6c650e798e2f49c14fbee07e4785656f3)), closes [#2315](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2315)

## [1.7.4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.3...v1.7.4) (2026-01-23)


### Bug Fixes

* full screen qr ([85c75d5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/85c75d551fb01b1722e8d684586c3b0f689c0d7b)), closes [#2313](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2313)
* removing workflow execution step from schema ([995703e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/995703eb712f2881f8a7d68c7bd4ed6c50f6c3dc)), closes [#2310](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2310)
* updated notification schema ([2cb4442](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2cb44426d97e9163aa7be4bd5ec13547d3ee9e16)), closes [#2317](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2317)

## [1.7.3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.2...v1.7.3) (2026-01-23)


### Bug Fixes

* Implement auto-focus after adding a user ([cf170c7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cf170c746f770ec90f9a19bcc71b277b96f784d0)), closes [#2292](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2292)

## [1.7.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.1...v1.7.2) (2026-01-23)


### Bug Fixes

* removing unecessary queries ([d5997fe](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/d5997fe147f33aa0d0dedb967730dad94e0871c1)), closes [#2273](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2273)

## [1.7.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.7.0...v1.7.1) (2026-01-23)


### Bug Fixes

* initialization fix ([c8a3122](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c8a3122daf33ed0e1e88365067996c49d8bc2984)), closes [#2296](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2296)

## [1.7.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.6.1...v1.7.0) (2026-01-23)


### Features

* integrate crashlytics and implement soft update via remote config ([69e4105](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/69e41052d0023a88d363922d53e3435d644870a6)), closes [#2268](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2268)


### Bug Fixes

* fixed routing for new Windows ([62be8f2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/62be8f2b19e2396d1adffd043bf2556bcfa60db9))

## [1.6.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.6.0...v1.6.1) (2026-01-23)


### Bug Fixes

* Added dir redirect for outdated paths ([cdc8b85](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/cdc8b859bed76e284737a2d2566b8d6cfdb8b944)), closes [#2282](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2282)

## [1.6.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.5.0...v1.6.0) (2026-01-23)


### Features

* CAC integration ([b2e38e0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b2e38e0478dafe02074ad986cccc1e1f986356d7)), closes [#2166](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2166)


### Bug Fixes

* adding sleep 10 for jenkins to settle multi branch pipeline ([657ddbb](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/657ddbb8b13caf3b8f6206a07d356e6ab3cb19c8)), closes [#2271](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2271)
* ETA UX fix ([3a64d61](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/3a64d618817127d33c050ae6c8e700789be8db27)), closes [#2294](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2294)
* Fix UI breakage for tickets containing links ([bb9ee56](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/bb9ee56ea780fef8118bafd6167a02bcf9cc718f))
* Fixed edge case ([ae415a2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ae415a2dedefe4982895e621881781cf0b9b5178))
* Fuzzy Fallback ([88bf06b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/88bf06bcd96edc06c410946dc93c6a15f846250a)), closes [#2214](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2214)
* Native call improvements ([0c39087](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c390870d557e6083eefedbe3e698a0ff4abb57c)), closes [#2252](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2252)
* Retry zero connection ([c56e771](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/c56e771087c4774c926ae4440d196877d8385228)), closes [#2264](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2264)
* update channel_user_status on mark as read ([a113d7f](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a113d7fdfc88f831943feae810964971447f2afb)), closes [#2254](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2254)

## [1.5.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.4.0...v1.5.0) (2026-01-22)


### Features

* Implement a dedicated notification worker, enhance delivery status tracking, and optimize real-time notifications with Redis Pub/Sub. ([a03792e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/a03792e214c474eedd49db99fa64b48502b798d2)), closes [#2118](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2118)

## [1.4.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.3.4...v1.4.0) (2026-01-22)


### Features

* virtualizer for kanban ([b11fd55](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b11fd55db3beaaf4e5f4006b52aa8e8b1106918d)), closes [#2238](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2238)

## [1.3.4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.3.3...v1.3.4) (2026-01-22)


### Bug Fixes

* channel seelction option in ticket creation via call agent ([9fb8187](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9fb81878df520b633387376ea93afeec4d571659)), closes [#2246](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2246)

## [1.3.3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.3.2...v1.3.3) (2026-01-22)


### Bug Fixes

* Added Group DM Stats ([0f6a34c](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0f6a34c60837ce2e3e21c8f1098e8a81b0083412)), closes [#2247](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2247)

## [1.3.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.3.1...v1.3.2) (2026-01-22)


### Bug Fixes

* updated genius api url ([41a285e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/41a285e9809c406dab7abeae36dabd9b6d79d09c)), closes [#2232](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2232)

## [1.3.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.3.0...v1.3.1) (2026-01-22)


### Bug Fixes

* subticket getting created even if board is not selected ([4f11763](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4f11763be571a72bed5a0a8f52d53a4f4571d94b)), closes [#2229](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2229)

## [1.3.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.2.0...v1.3.0) (2026-01-22)


### Features

* Added form filed in kanban filter based on boardId ([9b0cf16](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/9b0cf16f5b545af4a5e4fc3eeaf61b4a962d386a)), closes [#2179](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2179)
* ticket ETA activity ([b4dbfb6](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/b4dbfb697885bbed447fa84ddedc82bc681a71a8)), closes [#2013](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2013)


### Bug Fixes

* adding release brach creation from jenkins ([ad16c5d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ad16c5d69cb30fff649ba06644cc06b3025dc024)), closes [#2196](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2196)
* fixing ui ([ca8165d](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/ca8165d63642b67ff8de1555d46e65995edce7f1))
* implement health check and port management for docs publish server ([323bb2b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/323bb2b4e5eb61a1e1c7302c1e031622a4c59b50)), closes [#2215](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2215)
* Make repo optional for docs publish and fix gray screen for vs code panel ([1f43936](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1f43936ee2d612efdd24101ec19168e7dab47de6))
* removing outdated release branch regex from package.json ([2b8f6a7](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/2b8f6a7197aeb34a73dbb176b63f8236b277f067)), closes [#2213](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2213)
* single select option overflow ([0c54acd](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c54acdb931ef1f89d1eeeb746d3e8a5faa2206a)), closes [#2225](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2225)

## [1.2.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.1.0...v1.2.0) (2026-01-21)


### Features

* Add Jenkins integration with build triggering and status retrieval ([f700450](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f7004503bf813b33aabbcb7be4cd78d12756c176)), closes [#2143](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2143)


### Bug Fixes

* Thread msg grouping logic ([51c8f4a](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/51c8f4a97a73686072fa4663f98e92738d98409d)), closes [#2198](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2198)

## [1.1.0](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.5...v1.1.0) (2026-01-21)


### Features

* added flavor ([844f14b](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/844f14b5920dd351447d9fdcab71357141bff015)), closes [#2188](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2188)

## [1.0.5](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.4...v1.0.5) (2026-01-21)


### Bug Fixes

* making subemenu css consitent in the tickets filters ([f3e1bba](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/f3e1bbab28abc82c08ac50a104eb3ba575ba9791)), closes [#2190](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2190)

## [1.0.4](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.3...v1.0.4) (2026-01-21)


### Bug Fixes

* Fix ticket tag not working while creating thru ticketModal ([1e23aff](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/1e23aff153c1ca4df5fe45a3cc2dc4d166746e77))

## [1.0.3](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.2...v1.0.3) (2026-01-21)


### Bug Fixes

* update authorization for ticket duplicate backfill script ([eb050cc](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/eb050ccfd54c8a4d15d5d9d5df45b0fbfbfe8474)), closes [#2146](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2146)

## [1.0.2](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.1...v1.0.2) (2026-01-21)


### Bug Fixes

* disabling husky before commits ([75cde14](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/75cde14e7ce81918e8d740bbe67127a2ca0f0caa)), closes [#2152](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2152)

## [1.0.1](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/compare/v1.0.0...v1.0.1) (2026-01-20)


### Bug Fixes

* - fixed json text paste in chat input ([0c08888](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/0c08888a6971d471e24446982c53239cfd9bc114))
* button not visible in black/white bg fixed it ([fabfa5e](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fabfa5eda1d1ebf6570f3839ffc9d9b306bcb1d2))
* Fix single select option overflow in ticket modal ([766ea54](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/766ea5426201fcee4543ec2c4bd9c7933a5d43ae))
* Fixed refresh logic ([fbe9c69](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/fbe9c69f1610ed201705d26b1b323f6750b3c518))
* skip husky in jenkins ([4f96b88](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/commit/4f96b884c38868a0749864f13b0f2f3e58855295)), closes [#2119](https://ssh.bitbucket.juspay.net/XYNE/xyne-spaces/issues/2119)
