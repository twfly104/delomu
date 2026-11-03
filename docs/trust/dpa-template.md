# Data Processing Agreement (template)

> **This is a starting template, not legal advice.** Have a lawyer review it, and fill in the bracketed parts,
> before you send it to a customer.

This Data Processing Agreement ("DPA") is between **[Customer legal name]** ("Customer") and **[Grapim legal
entity]** ("Grapim"), and forms part of the agreement for Grapim's services dated **[date]** (the "Agreement").

## 1. Roles

Customer is the controller of the personal data in the material it provides. Grapim processes that data only as
Customer's processor, to deliver the services in the Agreement.

## 2. What is processed

- **Data:** the policies, documents, support tickets and test conversations Customer provides or that Grapim sends
  to Customer's AI system during testing.
- **People:** Customer's end users and staff who appear in that material.
- **Purpose:** testing, evaluating and monitoring Customer's AI system before and after launch.
- **Duration:** the term of the Agreement, then deletion under section 8.

## 3. Instructions

Grapim processes personal data only on Customer's documented instructions, including this DPA. Grapim will tell
Customer if it believes an instruction breaks data-protection law.

## 4. Confidentiality

Everyone at Grapim who can access the data is bound by confidentiality.

## 5. Security

Grapim keeps the measures described in its security page (SECURITY.md), including role-based access, single
sign-on, CSRF protection, a hash-chained audit log, prompt-injection guards, and refusal of model providers that
train on submitted data.

## 6. Subprocessors

Customer authorizes the subprocessors listed in docs/trust/subprocessors.md. Grapim will give Customer
**[30]** days' notice before adding one, and Customer may object on reasonable data-protection grounds.

## 7. Help with rights requests and incidents

Grapim will help Customer answer data-subject requests, and will notify Customer without undue delay, and within
**[72]** hours, after becoming aware of a personal-data breach affecting Customer's data.

## 8. Deletion

At the end of the Agreement, or on Customer's request, Grapim deletes Customer's data within **[30]** days,
including any entries in the knowledge library, unless law requires keeping it.

## 9. Knowledge library

Grapim adds de-identified test cases from Customer's deployments to its cross-customer library only with
Customer's separate written consent, recorded in the deployment's configuration. Customer may withdraw consent at
any time, and Grapim will then remove those entries.

## 10. Audits

Grapim will make available the information needed to show compliance with this DPA. **[Until Grapim holds a SOC 2
report, describe the audit right here: for example, a written security questionnaire once a year.]**

## 11. International transfers

**[Describe where data is processed and the transfer mechanism, for example the EU Standard Contractual Clauses,
or state that the service is self-hosted in Customer's own cloud region.]**

Signed for Customer: ____________________ Date: __________

Signed for Grapim: ____________________ Date: __________
