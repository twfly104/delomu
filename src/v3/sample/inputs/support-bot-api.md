# Tallyfox support assistant: integration guide

The Tallyfox support assistant is a command-line program. It answers one customer message per call.

## Calling the bot
- Command: `node ../mock-bot.mjs` (run from the deployment folder, so the path is relative to it).
- Input: the customer's message as plain UTF-8 text on standard input.
- Output: the bot's answer as plain text on standard output. Exit code 0 on success.
- No authentication is needed for the local build. The hosted build will use an API key that
  Tallyfox will provide as the environment variable `TALLYFOX_BOT_API_KEY`; it is not available yet.

## Example
```
echo "Do you ship to Canada?" | node ../mock-bot.mjs
Yes, we ship to the US and Canada. Delivery takes 3-7 business days.
```

## Limits
- One message per call; the bot keeps no conversation history.
- Answers usually take under one second. Treat anything over 30 seconds as a failure.
