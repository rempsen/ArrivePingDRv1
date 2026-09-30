Getting the Real Production Config Out of Runable — Instructions for Dan and Joel

Prepared 24 August 2026. For: Dan Rosenblat (to action) and Joel Tetrault (VP Software, the recipient).

Summary

The production environment values for uberize.ai are stored in Runable's Secrets panel, not in the repository. They are visible one at a time behind an eye icon, and there is no bulk export — so retrieving all 31 of them is a manual, roughly 15-minute job that only Dan can do.[^1]

Two things are worth knowing before you start. First, five of the variables are locked by Runable and cannot be edited, though they can still be read. Second, the copy of .env I already sent has live, working Turso database credentials in it — so if all Joel's developer needs is database access for local work, that file is already sufficient and this whole exercise is optional.

1. Why the repository copy is not enough

The .env file sitting in the sandbox repository is a local development file. It has drifted from what is actually deployed. Two visible symptoms inside the file itself:

Variable	Value in the repo copy	What production should say
NODE_ENV	development	production
WEBSITE_URL	a temporary preview URL	https://uberize.ai

Where the two copies disagree, Runable's Secrets panel is the truth — that is what the live site actually runs on. The repo copy is a snapshot that stopped being accurate at some point.

The one part of the repo copy that is live and correct: DATABASE_URL and DATABASE_AUTH_TOKEN. Local development has always pointed straight at the production Turso database, so those credentials work as-is.

2. How to open the Secrets panel

Go to the chat where the website was built and published. This is the important step and the easy one to get wrong — Secrets are attached to a specific chat, not to your account as a whole. It is the NVC360 chat that owns the uberize.ai deployment, which is a different chat from this one.

Click the Dashboard tab.

Select Secrets in the sidebar.[^1]

You will see the full list of variables as key–value pairs, with add, edit, and delete controls.

3. How to read a value

Values are masked by default. For each one:

Click the eye icon to reveal it.

Click the copy button to copy it to the clipboard.[^1]

There is no "export all" or "download as file" option, and no way to import from a file either — Runable's own documentation states variables must be added one at a time through the dashboard.[^1] So this is 31 reveal-and-copy operations, pasted into a document as you go.

4. The five locked variables

These are created and managed by Runable and cannot be edited or deleted. They carry a "protected" indicator in the dashboard:[^1]

Variable	What it is for
AI_GATEWAY_BASE_URL	URL for the AI gateway behind the app's AI features
AI_GATEWAY_API_KEY	Key for that gateway
BETTER_AUTH_SECRET	Secret for the login/authentication system
VITE_BASE_URL	The site's base URL
AUTUMN_SECRET_KEY	Secret for the payment billing system

The documentation confirms these cannot be modified. It does not explicitly say whether the eye icon reveals them for reading — I could not verify this either way, so treat it as an open question until you try it. If they turn out to be unreadable, that is a genuine constraint worth flagging to Joel: it means part of the production configuration is not portable off Runable, which matters for any future migration.

5. The checklist

Thirty-one variables. Tick them off as you copy:

#	Variable	#	Variable
1	RESEND_API_KEY	17	S3_ENDPOINT
2	EMAIL_FROM	18	S3_BUCKET
3	TWILIO_ACCOUNT_SID	19	S3_ACCESS_KEY_ID
4	TWILIO_AUTH_TOKEN	20	S3_SECRET_ACCESS_KEY
5	TWILIO_FROM_NUMBER	21	AI_GATEWAY_BASE_URL 🔒
6	GOOGLE_MAPS_API_KEY	22	AI_GATEWAY_API_KEY 🔒
7	APP_URL	23	BETTER_AUTH_SECRET 🔒
8	STRIPE_SECRET_KEY	24	AUTUMN_SECRET_KEY 🔒
9	STRIPE_PUBLISHABLE_KEY	25	WEBSITE_URL
10	REDIS_URL	26	APPLICATION_ID
11	GOOGLE_CLIENT_ID	27	VITE_RUNABLE_AUTH_ISSUER
12	GOOGLE_CLIENT_SECRET	28	VITE_APPLICATION_ID
13	RUNABLE_AUTH_ISSUER	29	RUNABLE_URL
14	NODE_ENV	30	VITE_SENTRY_DSN
15	DATABASE_URL	31	SENTRY_DSN
16	DATABASE_AUTH_TOKEN	
	


🔒 = protected/locked by Runable. Note that the production list may also contain VITE_BASE_URL, which is a Runable-managed variable that does not appear in the repo copy — so don't be surprised by a 32nd entry.

A faster alternative to copying all 31: open the file I already sent (nvc360-sandbox-env-FULL.env), reveal each value in the dashboard, and only write down the ones that differ. Most will match. That turns a transcription job into a spot-check, and it produces something more useful — a short list of exactly where the repo has drifted from production, which is information Joel will want anyway.

6. Two cautions

Do not edit anything while you are in there. The Secrets panel is live: the documentation states that saving a variable applies it to the running deployment automatically.[^1] A typo in DATABASE_URL takes uberize.ai down. You are there to read, not to change.

Watch how the finished file travels. Once assembled it contains the live Stripe secret key, the Twilio auth token, the Redis password, and the non-rotatable Turso credential. Send it through a password manager share (1Password, Bitwarden), not email or Slack. The Turso credential in particular cannot be revoked or reissued — NVC360 does not own that Turso account — so it is the one secret in the set that you can never take back once it has been shared.

Method and limitations

Instructions are drawn from Runable's official documentation page for environment variables, retrieved 24 August 2026 and saved to sources/. The variable list and the drift evidence in §1 come from reading the .env file in /home/user/nvc360-v4 directly.

I could not verify the following, because the Runable dashboard is a web interface I have no access to from the sandbox: the exact on-screen wording and layout, whether protected variables can be revealed for reading, and whether the deployed variable list matches the repo's 31 keys exactly. The steps in §2 and §3 are what the documentation describes, not something I have clicked through myself. If the screen does not look like this, that is a documentation-versus-product gap rather than a mistake in following the instructions.

[^1]: Runable Docs, "Environment Variables" (Build Websites section). https://docs.runable.com/environment-variables — retrieved 24 August 2026, saved at sources/runable-docs-environment-variables.md.

Text
Text
Heading 1
Heading 2
Heading 3
