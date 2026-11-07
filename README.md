# haul

Ohio City Farm's members' site: Supper Club subscriptions, charged through Square. Scope is in `docs/SPEC.md`.

## Setup

```
npm ci
cp env.example .env.local
```

`env.example` names every variable the app reads. Git ignores every `.env*` file.

## Database

```
npm run db:up
npm run db:migrate
npm run db:seed:supper-club
```

## Run

```
npm run dev
```

Open `http://mill-dev:4000`. Without keys, sign-in codes print to the server console and payments use the
fake. `env.example` says which keys turn on email and Square.

## Check

```
npm run verify
```

## Square sandbox

`npm run test:square` runs the payments contract against Square's real sandbox. It needs the network and
`SQUARE_SANDBOX_ACCESS_TOKEN` and `SQUARE_SANDBOX_LOCATION_ID` in `.env.local`. It deletes the customers it
creates; the cards and payments it makes stay in the sandbox.

`npm run square:seed` makes the sandbox customers the by-hand checks need. It leaves them in the sandbox.

### Start over with a new sandbox

1. TODO(Eric): the Square dashboard steps for making a new sandbox and finding its values.
2. Put the new values in `.env.local`: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`,
   `NEXT_PUBLIC_SQUARE_LOCATION_ID`, `SQUARE_SANDBOX_ACCESS_TOKEN` and `SQUARE_SANDBOX_LOCATION_ID`.
3. `npm run square:seed`
4. `npm run db:reset:dev` (destructive: it empties every table in the dev database, because rows there can
   point at the old sandbox's customers. Run `npm run db:seed:supper-club` after it.)

Whether `NEXT_PUBLIC_SQUARE_APPLICATION_ID` changes is written here once Eric has done it.

## More

Everything else (commands, conventions, the data model) is in `.claude/CLAUDE-context.md`.
