How to unblock the AWS policy — step by step

For Dan, August 21, 2026. Written for a non-technical reader. Verified against AWS's own documentation, not from memory. Sources at the end.

The short version

You can't edit that policy today, and it's not because you lack permissions — it's because AWS owns it, not you.

The account you set up (NVC360 App v5) is a new-style AWS "Project" account. In that setup, AWS writes and enforces the safety rules for you. In AWS's own words: "Previously, AWS managed RCPs and SCPs on your behalf."[^1] That's the policy that blocked me.

There is exactly one official button that changes this. It's called "Activate advanced features" — and it's the box already sitting at the bottom of the Projects page in your screenshot, the one that says "Activate advanced features / Continue to activation."

So the real decision isn't "how do I edit the policy." It's "do we want to graduate this account from AWS's training wheels to a real, self-managed AWS setup?"

Three things you must know before clicking, then the click-by-click steps.

Before you click: three things that matter
1. It cannot be undone

AWS states this flatly: "Activation cannot be reversed."[^2] There's no button to go back to the simple version. That's not a disaster — it's how every normal AWS account already works, and it's where you'd end up eventually anyway. But it's a one-way door, so read the other two points first.

2. You lose the spend limit, and that's a genuine downgrade

Right now your account can have a hard spend limit — AWS actually stops launching new resources when you approach it. That's real protection for a non-technical owner.

After activating, AWS says: "If you have a spend limit for any of your AWS accounts, it is removed. You cannot create a spend limit if you activate advanced features."[^1] You get the full professional billing toolkit instead — Budgets, Cost Explorer, anomaly detection.

Be clear on the difference: a spend limit stops spending. A budget only emails you. I already set up a $40/month budget with alerts to dan@nvc360.com at 50%, 90%, and forecast-to-exceed, so you're not flying blind — but after activation, nothing automatically slams the brakes. Given the whole footprint I've designed is about $25/month, the risk is modest, but you should know it's a trade, not a free upgrade.

3. I could not verify what happens to your $100 in credits — please confirm this before clicking

This is the one thing I couldn't nail down, so I'm flagging it rather than guessing.

Your account shows $100 in credits and 185 days remaining on the free plan (expires Feb 21, 2027). AWS's documentation on activating advanced features says nothing about credits either way. Separately, AWS has a different action called "Upgrade your account" (Billing → Upgrade, add a payment method), which is the free-plan-to-paid-plan move.[^3] I believe these are two separate things, and that activating advanced features does not by itself burn your credits — but I could not confirm it, and there are secondhand reports of people losing credits when enabling account features.[^4]

What to do: before you confirm anything, read the confirmation screen carefully — AWS shows a summary of exactly what will change. If credits aren't mentioned, open a free support case (Step 0 below) and ask directly. Two days of waiting is cheaper than losing $100 and finding out the hard way.

Step 0 (recommended): ask AWS first

Five minutes, free, and it removes the only real unknown.

Go to https://settings.aws.com and sign in as dan@nvc36... (your owner login).

In the left menu, click Support.

Create a new case / ask a question.

Paste this in:

I have a Project account (account ID 293174400261) on the free plan with $100 in credits. I want to activate advanced features so I can modify the service control policies that AWS currently manages for me. Will activating advanced features affect my $100 in credits or my free plan status in any way? Will it move me to a paid plan?

Wait for the reply before doing Part 1.

If the answer is "no effect on credits" — proceed. If it's "yes, you lose them" — tell me, and we stay on the setup I've already built, which works.

Part 1: Activate advanced features

Once you're comfortable with the three points above.

Go to https://settings.aws.com and sign in.

In the left-hand menu, click Projects. This is the page in your screenshot.

Scroll to the bottom to the box headed "Activate advanced features."

Click Continue to activation.

Read the summary screen. It lists everything that will change. Specifically look for any mention of credits or your plan. If it says something that contradicts what AWS Support told you, stop and send me a screenshot.

Confirm.

That's it. AWS then makes you the administrator of your own organization, and creates one extra housekeeping account behind the scenes (a "delegated administrator" — normal, ignore it).

One thing to avoid: somewhere in this area you may see an option to change your identity source from AWS Builder ID to something else. Don't touch it. It's separately irreversible[^1] and we don't need it.

Part 2: Remove the blocking policy

Now the policy is yours to change. This part is more technical — I'd suggest letting Joel do it, or telling me it's unlocked and I'll do it in a couple of minutes. But here's the path so you can see it or follow along.

From AWS Settings, open the full AWS Management Console.

In the search bar at the top, type Organizations and open AWS Organizations.

In the left menu, click Policies.

Click Service control policies.

Find the policy with the ID p-2vlxg9hb. That's the exact one that blocked me — the error message named it.

Click it, then open the Targets tab. You'll see it's attached to your account or to a group containing it.

Either:

Detach it from the NVC360 App v5 account (simplest), or

Edit it and remove just the two blocks we're hitting: apprunner:* and iam:CreateOpenIDConnectProvider.

Do not detach every policy. AWS requires at least one to remain attached, and there's a default one called FullAWSAccess that must stay.[^5] Leave that alone — only the restrictive one comes off.

Detaching is the cleaner choice for now. Once Joel is settled in, he'll likely want to write proper NVC360-specific guardrails, which is exactly the kind of thing a VP of Software should own.

Part 3: Tell me, and I'll finish it

Message me "policy is off" and I'll do the following — roughly 30 minutes of work, all already written and waiting:

What	Why it matters
Create the GitHub OIDC connection	Deletes the need for a long-lived AWS key sitting in your GitHub secrets. This is the security item I flagged.
Switch staging from Fargate + load balancer to App Runner	Saves about $16/month and removes moving parts.
Re-run Terraform and stand staging up	The actual staging environment Joel asked for.
If you'd rather not do any of this

Completely legitimate. Here are your three options side by side.


	What you do	Cost	Downside
A. Activate advanced features	Steps above	~$9/mo (App Runner)	Irreversible; lose the hard spend limit
B. Do nothing	Nothing — I've already built around the block	~$25/mo (needs a load balancer)	~$16/mo more forever; a long-lived AWS key lives in GitHub
C. Open a separate ordinary AWS account	Sign up again using AWS's "advanced" signup	~$9/mo	Separate bill; probably no $100 credit; the foundation I built gets rebuilt elsewhere

My recommendation: A, but on Joel's timeline, not today.

Reasoning: the Project-account model is designed for people learning AWS, not for a company running production SaaS. Its AWS-managed guardrails have already blocked us twice in one afternoon (App Runner, and the secure CI login). Joel will hit a third and a fourth. You're going to activate eventually, so do it deliberately with your VP of Software present rather than under pressure later.

But it's genuinely not urgent. Option B is running right now and staging can go up on it this week. The $16/month is annoying, not blocking. The one thing I don't love about B is the long-lived key in GitHub — if we stay on B for more than a month or two, we should rotate that key on a schedule.

What I'd actually do: send the support question in Step 0 today, get the credits answer, then have Joel click Part 1 and Part 2 in one 15-minute sitting when he's next in the account.

If something goes wrong

You clicked and something looks broken: nothing you do in Part 1 touches uberize.ai. Your live product runs on Runable, completely separately, and has no connection to this AWS account. There is no way to break production from here.

You can't find the "Activate advanced features" box: AWS is rolling this experience out gradually and warns it may not be available to every customer yet.[^1] If it's missing, take a screenshot and send it to me — that changes the answer to Option B or C.

You get an error you don't understand: screenshot it and send it over. Error messages in AWS name the exact policy blocking you, which is how I identified p-2vlxg9hb in the first place.

Where these facts come from

All of this is from AWS's official documentation (the highest-reliability source available), read today — not from my general knowledge. The one item I could not verify from an official source is explicitly flagged as unverified above.

[^1]: AWS Account Management User Guide, "Activate advanced AWS features" — https://docs.aws.amazon.com/accounts/latest/reference/activate-advanced-features.html — source of the "AWS managed RCPs and SCPs on your behalf", spend-limit removal, identity-source irreversibility, and limited-rollout statements. Accessed 2026-08-21.

[^2]: Same guide, PDF edition: "You can activate advanced features in AWS Settings. Activation cannot be reversed." Accessed 2026-08-21.

[^3]: AWS Account Management User Guide, "Upgrade your account" — the separate Billing → Upgrade → payment-method flow, which is distinct from activating advanced features. Accessed 2026-08-21.

[^4]: Secondhand community reports of credits being affected when enabling account-level features. Low reliability — this is exactly why Step 0 exists. Not treated as fact anywhere in this document.

[^5]: AWS Organizations guidance: every entity must have at least one SCP attached, and the last one cannot be removed — hence leaving FullAWSAccess in place.

Facts about your own account (account ID 293174400261, organization o-6bve4kb61f, management account 759046793211, policy p-2vlxg9hb, region us-east-2, $100 credits / 185 days) came from your two screenshots and from live API calls I made against the account today.

Text
Text
Heading 1
Heading 2
Heading 3
