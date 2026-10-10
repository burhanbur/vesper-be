import ts from 'typescript';

export type ListedRoute = { method: string; path: string };

/** Inspect literal route declarations without starting application infrastructure. */
export function declarations(source: string, receiver: string): ListedRoute[] {
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
  const routes: ListedRoute[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const expression = node.expression;
      const method = expression.name.text;
      const path = node.arguments[0];
      if (
        expression.expression.getText(file) === receiver &&
        ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'all'].includes(method) &&
        path &&
        ts.isStringLiteralLike(path)
      ) {
        routes.push({ method: method.toUpperCase(), path: path.text });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return routes;
}

export function mounts(source: string): { prefix: string; module: string }[] {
  const file = ts.createSourceFile('app.ts', source, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const binding of bindings.elements)
      imports.set(binding.name.text, statement.moduleSpecifier.text);
  }
  const result: { prefix: string; module: string }[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(file) === 'app' &&
      node.expression.name.text === 'use'
    ) {
      const prefix = node.arguments[0];
      if (prefix && ts.isStringLiteralLike(prefix)) {
        for (const argument of node.arguments.slice(1)) {
          if (!ts.isCallExpression(argument) || !ts.isIdentifier(argument.expression)) continue;
          const module = imports.get(argument.expression.text);
          if (module?.endsWith('.route.js')) result.push({ prefix: prefix.text, module });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return result;
}
