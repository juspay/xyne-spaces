# Xyne Desk mock DL membership delivery

## Member in three DLs receives all DL mails and stops receiving removed DL mails
* using browser
* logging in as user "admin-1"
* resetting mock DL provider state
* creating mock DL "mock-dl-a"
* creating mock DL "mock-dl-b"
* creating mock DL "mock-dl-c"
* adding member "desk-member@example.test" to mock DL "mock-dl-a"
* adding member "desk-member@example.test" to mock DL "mock-dl-b"
* adding member "desk-retained-member@example.test" to mock DL "mock-dl-b"
* adding member "desk-member@example.test" to mock DL "mock-dl-c"
* sending mock provider mail "first-mail-a" to mock DL "mock-dl-a"
* sending mock provider mail "first-mail-b" to mock DL "mock-dl-b"
* sending mock provider mail "first-mail-c" to mock DL "mock-dl-c"
* verifying mock inbox "desk-member@example.test" total mail count is "3"
* verifying mock inbox "desk-member@example.test" has "1" mails from mock DL "mock-dl-a"
* verifying mock inbox "desk-member@example.test" has "1" mails from mock DL "mock-dl-b"
* verifying mock inbox "desk-member@example.test" has "1" mails from mock DL "mock-dl-c"
* removing member "desk-member@example.test" from mock DL "mock-dl-b"
* sending mock provider mail "second-mail-a" to mock DL "mock-dl-a"
* sending mock provider mail "second-mail-b" to mock DL "mock-dl-b"
* sending mock provider mail "second-mail-c" to mock DL "mock-dl-c"
* verifying mock inbox "desk-member@example.test" total mail count is "5"
* verifying mock inbox "desk-member@example.test" has "2" mails from mock DL "mock-dl-a"
* verifying mock inbox "desk-member@example.test" has "1" mails from mock DL "mock-dl-b"
* verifying mock inbox "desk-member@example.test" has "2" mails from mock DL "mock-dl-c"
