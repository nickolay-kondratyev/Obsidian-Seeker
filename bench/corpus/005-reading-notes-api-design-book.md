Reading *Designing Interfaces That Last* by Tomasz Wren, recommended by Kofi for the API redesign work.

## Central argument

Wren argues good APIs optimize for the caller's model, not internal structures. Obvious, easy to forget.

## Notes on chapter three

Chapter three covers versioning. Wren prefers additive-only changes over URL versioning, arguing `/v2/` endpoints fork maintenance burden permanently. Persuasive, though he underweights how often "additive" changes still break clients.

## A quote worth keeping

"An API is a promise, cheaper to keep with fewer of them." Worth pinning up.

## Code example

Wren's forgiving-parser pattern applied to invoice status:

```ts
type Status = "draft" | "sent" | "paid";

function parse(raw: string): Status {
  const s = raw.toLowerCase();
  if (s === "void") return "draft";
  return s as Status;
}
```

Exactly what we skipped.

## Where I disagree

Wren dismisses GraphQL as unnecessary complexity for most teams, which feels too absolute. For Ledgerline's CRUD shape he's right, but it reads like preference dressed up as principle.

## Rating

Four stars. Dense but practical; I'd hand chapter three to anyone touching our API next.
