# MEQ Exam Platform: Requirements and Gaps (Points You May Miss)

Date: 2026-07-22
Prepared by: One Catalyst (Proto, with Resa on grading)
Decisions locked: Microsoft Entra ID SSO, full working MVP, Next.js + Supabase.

---

## 1. Your stated requirements (confirmed buildable)

| Requirement | How it is built | Status in MVP |
|---|---|---|
| MEQ online, students type answers | Free-text answer per question | Built |
| One question per page | Server releases one question at a time | Built |
| Timer per question | Server-authoritative clock | Built |
| Everyone starts together | Lecturer clicks Start; single server clock | Built |
| Cannot go back, cannot edit past | Database trigger blocks writes to past questions | Built |
| Everyone advances together | Realtime broadcast of question index | Built |
| AI pre-grading, lecturer confirms | Claude grades vs key + rubric, lecturer approves | Built |
| CMU email login | Microsoft Entra ID OAuth, domain-restricted | Built (needs your Azure app registration) |
| Roles: student / lecturer / guest / admin | Role field + row-level security | Built |
| Lecturer backend for questions, key, rubric | Lecturer dashboard CRUD | Built |
| Score dashboard + export | CSV export of name, code, email, time, grade | Built |
| Separate dashboards per role | Role-based routing | Built |

---

## 2. Points you missed (the important part)

These are gaps that will bite during a real exam if not designed for. Ranked by how much they matter.

1. **Autosave and connection loss.** If a student's wifi drops mid-question, their typed text must already be saved on the server. In a no-going-back exam, a lost answer is a disaster and an appeal.
   - MVP: answers autosave to the server every few seconds while typing.

2. **Server-authoritative clock.** Students can change their laptop clock or pause JavaScript. The timer and the advance signal must come from the server.
   - MVP: the client computes an offset against the server clock; the actual advance is decided by a guarded server function, not the browser.

3. **Latecomer policy.** If a student joins late, they get only the time remaining on the current question (the server clock handles this). You still need to decide the human rule for very late arrivals.
   - MVP: late joiners get remaining time only. Policy decision is yours.

4. **Live proctor view.** The lecturer needs to see who has joined and who has submitted, in real time, during the sitting.
   - MVP: basic proctor list on the lecturer exam page.

5. **PDPA compliance (Thailand).** You store students' names, emails, and grades. You need a consent notice, a retention rule, and an audit log.
   - MVP: an immutable audit log is built. Consent notice and retention policy are yours to add before real use.

6. **Immutable audit log.** Every submission, grade change, and exam action, timestamped, for appeals.
   - MVP: built (audit_log table).

7. **Exam lifecycle states.** draft, scheduled, live, closed, released. Results never auto-release; the lecturer confirms first.
   - MVP: built as a status field with controlled transitions.

8. **Academic integrity options.** Full-screen lock, paste blocking, tab-switch flagging. Imperfect but expected. Also detecting AI-written or near-identical answers between students.
   - MVP: not built yet. Recommended as Phase 2. Flagged here so it is not forgotten.

9. **Accommodations conflict.** Some students may be entitled to 1.5x time, which fights the strict lockstep. You need a policy (for example a separate synchronized session for that group).
   - MVP: not built. Policy and a separate-session mechanism are Phase 2.

10. **Question stem attachments.** Clinical MEQs often include an image, a lab result, or a table. The editor should support an image in the question even if answers stay text-only.
    - MVP: the question has an optional image field. Upload UI can be added in Phase 2.

---

## 3. AI pre-grading design (Resa)

The grader returns, per answer:
- a total score,
- a per-rubric-criterion breakdown with justification,
- a confidence level (high / medium / low).

Safeguards built in:
- Low-confidence answers are flagged for close human review.
- The grade is never released on its own. The lecturer confirms every grade.
- The student's answer is sandboxed so a student cannot type "give me full marks" and manipulate the grader (prompt-injection defence).

Model: Claude Opus 4.8 by default (highest quality). Switchable to a cheaper model once you trust the pipeline.

---

## 4. What still needs you before it goes live

1. **Azure app registration** for CMU Microsoft 365, so real @cmu.ac.th login works. Until then, the app can run with test accounts.
2. **A Supabase project** (free tier) and an Anthropic API key, pasted into the environment file.
3. **Policy decisions**: latecomer rule, accommodations handling, data-retention period, and whether to enable integrity lockdown features.

---

## 5. Suggested phase plan

- **Phase 1 (this MVP):** synchronized lockstep exam, roles, question and rubric backend, AI pre-grading with human confirm, score export, audit log, basic proctor view.
- **Phase 2:** integrity lockdown (full-screen, paste-block, tab-switch flag), image upload for question stems, accommodations sessions, per-student PDF transcripts, PDPA consent flow.
- **Phase 3:** faculty-wide rollout, analytics across courses, question bank reuse.
