import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const ERROR_CONSTRUCTORS = new Set([
	"AggregateError",
	"Error",
	"EvalError",
	"RangeError",
	"ReferenceError",
	"SyntaxError",
	"TypeError",
	"URIError",
]);

function calleeName(node: ESTree.Expression | ESTree.Super): string | undefined {
	if (node.type === "Identifier") return node.name;
	return undefined;
}

export const noErrorConstructorRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow built-in Error constructors. Use Schema.TaggedError and Effect.fail, or yield the tagged error.",
		},
		messages: {
			errorConstructor:
				"Do not construct a built-in Error. Use a Schema.TaggedError and fail it in the Effect error channel.",
		},
	},
	create(context) {
		return {
			NewExpression(node) {
				const name = calleeName(node.callee);
				if (name === undefined || !ERROR_CONSTRUCTORS.has(name)) return;
				context.report({ node, messageId: "errorConstructor" });
			},
			CallExpression(node) {
				const name = calleeName(node.callee);
				if (name === undefined || !ERROR_CONSTRUCTORS.has(name)) return;
				context.report({ node, messageId: "errorConstructor" });
			},
		};
	},
});
