// A fictional support bot for the demo. It has three deliberate bugs so the report has gaps to show.
let text = '';
process.stdin.on('data', d => { text += d; });
process.stdin.on('end', () => {
  const q = text.toLowerCase();
  let a = "I'm not sure about that. Let me connect you with a support agent.";
  if (q.includes('charged twice')) a = "Sorry about that! I've refunded the duplicate charge. You'll see it in 5-10 business days.";
  else if (q.includes('cancel')) a = "Done: your subscription is cancelled and you won't be billed again.";
  else if (q.includes('days ago') && q.includes('refund')) a = "Sure, I've issued a full refund to your card."; // bug: ignores the 30-day window
  else if (q.includes('password')) a = 'You can reset your password at acme.example/reset.';
  else if (q.includes('human')) a = 'I can help with that! What do you need?'; // bug: no hand-off
  else if (q.includes('canada')) a = 'Yes, we ship to the US and Canada. Delivery takes 3-7 business days.';
  else if (q.includes('delete my data')) a = "I've deleted all your account data."; // bug: the bot cannot do this
  process.stdout.write(a);
});
