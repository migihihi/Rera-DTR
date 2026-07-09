# Rera DTR Checker

An internal tool that checks time card/DTR, topsheet, and the payroll Excel
upload file for discrepancies before upload — automatically, across a whole
batch of employees instead of one at a time in a chat window.

This is a **v1 working prototype**, not a polished finished product. The
core flow works end to end; treat the first few real runs as a chance to
compare its output against how your team would normally check things, and
tell me what it gets wrong or misses so it can be tightened up.

## What it does

1. You upload the payroll Excel file once, and a batch of employee DTR PDFs
   (one file per promodiser — plus an optional topsheet per employee, if you
   have one).
2. For each employee, the tool pulls their rows out of the Excel file, sends
   their DTR (and topsheet, if given) to OpenAI's API along with those rows,
   and asks it to run the exact same review your custom GPT was already doing —
   same rules, same Taglish tone, same report format.
3. It does this for everyone in the batch automatically, and shows you one
   page of results, worst-first (Hold Upload items on top), so you're only
   reading closely where something actually needs a look.

## One-time setup (someone with Netlify + OpenAI accounts needs to do this)

### 1. Get an OpenAI API key
This tool calls the OpenAI API directly (not ChatGPT), using your existing
OpenAI billing — same account, different product, its own pay-per-use cost
separate from any ChatGPT subscription.
1. Go to https://platform.openai.com/api-keys
2. Create (or use an existing) Project.
3. Click **Create new secret key**. Copy it somewhere safe — you won't be
   able to see it again.
4. Confirm billing is set up under **Settings → Billing**. This tool pays
   per document processed.
5. Check https://platform.openai.com/docs for the current vision-capable
   model name before deploying — `checker-prompt.js` and `check-background.js`
   reference `gpt-5.5` as a starting point, but model names change; use
   whatever OpenAI's docs list as current and vision-capable.

### 2. Deploy this folder to Netlify
Easiest path — drag-and-drop:
1. Zip this whole folder (or push it to a GitHub repo, either works).
2. Go to https://app.netlify.com → **Add new site**.
3. If using drag-and-drop: drag the folder onto the page.
   If using GitHub: connect the repo and let Netlify auto-detect the build
   settings (it will read `netlify.toml` automatically).
4. Wait for the first deploy to finish — you'll get a URL like
   `https://your-site-name.netlify.app`.

### 3. Add the API key to Netlify (never put it in the code itself)
1. In your Netlify site → **Site configuration → Environment variables**.
2. Add a variable: Key = `OPENAI_API_KEY`, Value = the key from step 1.
3. Trigger a redeploy so the function picks it up (**Deploys → Trigger deploy**).

### 4. Enable Netlify Blobs (used to store progress/results while a batch runs)
This is on by default for most Netlify accounts on modern plans — if the tool
errors on "store" when you first test it, check **Site configuration →
Environment variables** for any Blobs-related setup Netlify's dashboard asks
for, or see https://docs.netlify.com/blobs/overview/.

That's it — from here on, nobody touches Netlify or the API key again. They
just use the website URL.

## Using it (this is the part your team does every cutoff)

1. Open the site URL.
2. Fill in the cutoff period and client/project name.
3. Upload the payroll Excel file.
4. Upload all the DTR PDFs for that batch at once (multi-select).
5. Check the auto-guessed employee name next to each file — fix any that
   guessed wrong (filenames aren't consistent enough to always get this
   right; that's expected, just correct it inline).
6. Attach a topsheet per employee if you have one — optional.
7. Click **Run Check**, wait for the progress bar.
8. Read the flagged (red/yellow) employees first. Click any row to expand
   the full report. Download the combined report if you want a saved copy.

## Known limitations of this v1 (things to watch for, not surprises)

- **No fuzzy name matching yet** — if an employee's name is spelled
  differently in the Excel file vs. the name you type for their DTR, the
  tool won't find their Excel rows and will (correctly) flag that as
  missing data. Worth normalizing spelling before upload in the meantime.
- **Large batches take a while** — each employee is a separate AI call, done
  one after another, so a batch of 100+ people will take some minutes, not
  seconds. The progress bar reflects real progress; it isn't stuck.
- **Topsheet format is unverified** — I built the topsheet handling based on
  your instructions describing what it should check, but haven't seen a
  real topsheet file yet, so treat any topsheet-related output with extra
  scrutiny until we've tested it against a real one.
- **This does not replace judgment on genuinely ambiguous cases** — per your
  original instructions, it will say "Needs Verification" rather than
  guess, which is intentional, not a bug.
