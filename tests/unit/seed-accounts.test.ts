import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Inspect seed definitions without importing the database-connected entry point.
const source = ts.createSourceFile(
  'seed.ts',
  readFileSync(new URL('../../prisma/seed.ts', import.meta.url), 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
const accounts: Record<string, string>[] = [];
function visit(node: ts.Node): void {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'seedAccounts') {
    if (!node.initializer || !ts.isArrayLiteralExpression(node.initializer)) {
      throw new Error('Expected seedAccounts to be an array literal.');
    }
    for (const entry of node.initializer.elements) {
      if (!ts.isObjectLiteralExpression(entry)) throw new Error('Expected account object.');
      const values: Record<string, string> = {};
      for (const property of entry.properties) {
        if (ts.isPropertyAssignment(property)) {
          values[property.name.getText(source)] = ts.isStringLiteral(property.initializer)
            ? property.initializer.text
            : property.initializer.getText(source);
        }
      }
      accounts.push(values);
    }
  }
  ts.forEachChild(node, visit);
}
visit(source);

describe('seed account definitions', () => {
  it('defines a single debt and receivable account', () => {
    const debtAccounts = accounts.filter(
      (account) => account.accountTypeName === 'Hutang & Piutang',
    );
    expect(debtAccounts).toHaveLength(1);
    expect(debtAccounts[0]?.id?.endsWith('000050')).toBe(true);
    expect(debtAccounts[0]?.name).toBe('Hutang');
    expect(debtAccounts[0]?.isIncludeTotal).toBe('true');
  });

  it('nests ordered mutual funds under Bareksa without double-counting the parent', () => {
    const parent = accounts.find((account) => account.id?.endsWith('000030'));
    expect(parent?.isIncludeTotal).toBe('false');
    const children = accounts.filter((account) => account.parentAccountId === parent?.id);
    expect(children.map((account) => account.name)).toEqual([
      'Reksadana STAR Stable Income Fund',
      'Reksadana Syailendra Stable Income Fund',
    ]);
    expect(children.map((account) => account.sequenceOrder)).toEqual(['1n', '2n']);
    expect(
      children.every(
        (account) => account.accountTypeName === 'Reksadana' && account.isIncludeTotal === 'true',
      ),
    ).toBe(true);
    expect(new Set(accounts.map((account) => account.id)).size).toBe(accounts.length);
  });
});
