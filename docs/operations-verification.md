# Operations verification — 3 November 2026

Verified locally with Docker Compose and the existing database volumes. This is not a
Hostinger deployment or a completed real payment test.

| Check                   | Result                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Production image        | Backend TypeScript and both Next.js applications built successfully; compiled services and `next start` run as the node user                                       |
| Runtime configuration   | `NODE_ENV=production`, development integration keys retained, `BILLING_PROVIDER=razorpay_test`                                                                     |
| Customer recipients     | Running API confirmed `EMAIL_TEST_MODE=false`; unit checks allow two different customer addresses while optional restricted mode still rejects an unlisted address |
| Sender                  | Single platform sender policy retained; Gmail SMTP connection authenticated without sending a message                                                              |
| Service health          | API, worker, users, admin, PostgreSQL, Redis, backups and Prometheus healthy                                                                                       |
| Metrics access          | Missing bearer token returned 401; authenticated request returned 200 and a live worker heartbeat                                                                  |
| Prometheus              | API scrape target reported `up=1`                                                                                                                                  |
| Frontend secrets        | Frontend runtime environment contained none of the checked SMTP, payment, signing, backup or monitoring secrets                                                    |
| Encrypted backup        | Online custom-format archive encrypted successfully; first checked archive was 61,122 bytes                                                                        |
| Actual isolated restore | Five migrations and one tenant restored; zero ledger mismatches and zero held-credit mismatches; encrypted mail fingerprint preserved                              |
| Wrong recovery key      | Restore rejected with exit code 1; correct-key restore then passed                                                                                                 |
| Cleanup                 | Zero temporary `autometa_restore_check_*` databases remained after the drills                                                                                      |
| Code checks             | Backend typecheck, lint and all ten unit tests passed                                                                                                              |
| Git layout              | Dummy-file check staged all three folders, excluded private/generated files, and kept metadata under backend; actual workspace was not committed or pushed         |

Backups run daily, retain fourteen complete copies and perform a weekly isolated restore drill.
The working database was not overwritten or switched during testing. An isolated restore never
runs the worker or sends email. Recovery into a new permanent database quarantines pending
messages and requires reconciliation before activation.

Remaining deployment work: configure public HTTPS origins/reverse proxy, run the SMTP connection
check on Hostinger, connect independent off-site backup storage, and connect a notification
receiver for unattended alerts. Prometheus currently evaluates rules locally. Razorpay remains
test-only; a captured gateway checkout and public HTTPS webhook must be checked separately.
No new recipient was sent an unsolicited test message by these checks.

See [production-beta.md](production-beta.md) for commands and recovery procedures.
