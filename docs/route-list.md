# Route listing

Run `npm run routes:list` from the backend root to print HTTP methods and full paths.

Filter by path: `npm run routes:list -- --path=auth`.
Filter by method: `npm run routes:list -- --method=POST`.
Both filters can be combined.

The command parses literal declarations in `src/app.ts`, mounted module route files,
and `src/docs/swagger.ts` using the TypeScript syntax tree. It does not import the
application or connect to PostgreSQL/Redis. Conditional module declarations are
included regardless of runtime configuration. Implicit Express HEAD/OPTIONS,
Swagger middleware assets, computed paths, and nested router mounts are not listed.
This is a source catalog, not a live-server introspection command.
