# Security Specification: GTM Signal & SDR Command Center

## 1. Data Invariants
1. A lead sync document under `/users/{userId}/leads/{leadId}` cannot exist without an existing parent `/users/{userId}` document belonging to the authenticated verified user (`request.auth.uid == userId`) or admin.
2. `ownerUid` and `createdAt` are immutable after document creation.
3. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. Users cannot self-assign `ADMIN` role on `/users/{userId}` creation or escalate `role` on update.
5. `SdrLeadSync` terminal state `DISQUALIFIED` cannot be modified by non-admin users once locked.
6. PII (`email`) is isolated in `/users/{userId}/private/info` and strictly readable only by the owner (`userId == request.auth.uid`) or verified admin.
7. All document IDs (`userId`, `leadId`, `configId`) must match `^[a-zA-Z0-9_\-]+$` and be `<= 128` chars.
8. Scoring weights in `ScoringRulePreset` must be numeric, non-negative, and sum to exactly `100`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated Write**: Unauthenticated client attempts `setDoc(/users/u1/leads/l1, ...)`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create `/users/u1/leads/l1`.
3. **Identity Spoofing (UID mismatch)**: Authenticated user `u2` attempts to create `/users/u1/leads/l1` with `ownerUid: "u1"`.
4. **Role Self-Escalation**: Authenticated user `u1` attempts to create `/users/u1` with `role: "ADMIN"`.
5. **Shadow Field Injection**: Authenticated user `u1` creates `/users/u1/leads/l1` with an extra shadow field `isVerifiedAdmin: true`.
6. **Orphaned Lead Write**: Authenticated user `u1` attempts to create `/users/u1/leads/l1` before `/users/u1` exists.
7. **Timestamp Forgery**: Authenticated user `u1` creates `/users/u1/leads/l1` with backdated `createdAt` instead of `request.serverTimestamp()`.
8. **ID Poisoning (1.5KB ID)**: Authenticated user `u1` targets `/users/u1/leads/${'a'.repeat(1500)}`.
9. **Value Poisoning on Update**: Authenticated user `u1` updates `totalScore` to a string `"999"` or `companyName` > 160 chars.
10. **Terminal State Bypass**: Authenticated user `u1` attempts to update a lead whose existing `stage == 'DISQUALIFIED'` back to `'APPROVED_SYNCING'`.
11. **PII Cross-User Read**: Authenticated user `u2` attempts `getDoc(/users/u1/private/info)`.
12. **Blanket List Scraping**: Authenticated user `u2` attempts `getDocs(/users/u1/leads)` without owning `userId` or being admin.
