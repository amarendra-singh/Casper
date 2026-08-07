# Mistakes — what not to repeat

Written from real mistakes made on this project. Each entry is: what happened,
why it happened, and the rule that prevents it. Read before starting work.

---

## 1. Editing when asked to discuss

**What happened:** Asked to "discuss first", presented options, got answers to the
scoping questions — then immediately started editing files instead of continuing
the discussion.

**Why:** Treated answered questions as approval to build. They were not; they were
answers *within* a discussion that had not finished.

> **Rule:** "Discuss first" stays in force until the user says build/do it. Answering
> a clarifying question is not approval. When in doubt, present the design and ask.

---

## 2. Trusting a green test suite over the running app

**What happened:** A scripted refactor produced `company_id == scope.ids` (comparing
a column to a *list*) in four route handlers. All 290 tests passed. Ledger, billing,
SKUs and fraud list endpoints were returning **HTTP 500** the whole time.

**Why:** The tests never exercised group mode on those routes, so the suite was
green and wrong. Verification stopped at "tests pass".

> **Rule:** After any bulk/scripted edit, hit the real endpoints. Green tests prove
> the covered paths work — not that the change works.

---

## 3. Bulk regex edits without reading the result

**What happened:** A script inserted a line "after the signature", which for a
multi-line `def` landed *inside* the parameter list and broke the module.

**Why:** Pattern assumed every signature was one line.

> **Rule:** After a scripted edit, `git diff` it and compile every touched file.
> Never commit a generated change you have not read.

---

## 4. Debugging code that was not running

**What happened:** Spent several rounds "fixing" a bug that was already fixed —
`uvicorn --reload` had not picked up the change, so the server was serving stale
code. Later, an orphaned socket held the port and answered with an old build.

> **Rule:** If a live check disagrees with the code, **hard-restart first**
> (stop → confirm the port is free → start). Confirm the fix is present in the
> running process before touching the code again.

---

## 5. Claiming done while it was visibly broken

**What happened:** Reported a dashboard redesign as complete while the SKU table
was rendering as a collapsed 5×2 grid, plainly visible on screen.

**Why:** Verified that code changed, not that the screen looked right.

> **Rule:** "Done" requires seeing the result — screenshot or DOM assertion on the
> actual thing the user will look at. Not "the edit applied".

---

## 6. Financial maths that looked right and was not

Three separate instances, all the same failure mode: a number that *rendered*
fine but was wrong.

- **Omitted cost lines.** Profit subtracted only COGS + overhead, silently dropping
  fulfilment and return cost. Overstated profit by ~10×.
- **Mismatched revenue and cost.** The statement counted sales from SKUs it had no
  cost for, so two screens disagreed on the same report (+₹2,883 vs −₹967).
- **Live vs frozen cost basis.** Costs were read live, so editing a SKU today
  silently changed *past* reports.

> **Rule:** For any money figure — state the formula, check both sides cover the
> **same** set of rows, and confirm it **foots** against something external (bank
> settlement). Cross-check every screen that shows the same number, and lock it
> with a test that fails if they diverge.

---

## 7. Proposing UI for data the API does not return

**What happened:** Proposed "show which company each row belongs to" without
checking. The response schemas expose no company field at all, so the UI had
nothing to render.

> **Rule:** Before designing a screen, confirm the data exists end to end.

---

## 8. Over-strict rules from not splitting the case

**What happened:** Blocked *all* writes in consolidated mode. But **create** is
ambiguous (no company yet) while **edit** is not (the record carries its own
company). One blunt rule blocked something that was always safe.

> **Rule:** Before forbidding an action, split it into cases and check whether the
> reason applies to each.

---

## 9. Native browser dialogs — made twice

**What happened:** Replaced `window.prompt` for company creation *because* the raw
browser box looked unfinished — then used `window.confirm` for the bulk category
fill days later. The user sent a screenshot of "localhost:5173 says".

**Why:** The first fix was treated as a one-off repair rather than a rule, so the
same reasoning was not applied the next time a dialog was needed.

> **Rule:** No `window.alert` / `confirm` / `prompt` in app flows — use
> `components/ConfirmDialog`. When a fix is made for a reason, apply the reason,
> not just the fix.

**Still outstanding:** Billing, Ledger, Users, Settings and Companies each still
call `window.confirm` for delete/archive. They should move to the shared dialog.

---

## 10. Space-wasting UI

**What happened:** Feature banners were added one under another until four
full-width rows sat above the first row of data.

> **Rule:** New status/notice UI merges into an existing row or header. Never a new
> full-width band above a data table. Data density is the point of this tool.
