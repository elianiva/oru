import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const INTERNAL_TAGS = new Set([
	"Some",
	"None",
	"Left",
	"Right",
	"Success",
	"Failure",
	"Fail",
	"Die",
	"Interrupt",
	"Empty",
]);

function literalTag(node: ESTree.Expression): string | undefined {
	if (node.type === "Literal" && typeof node.value === "string") return node.value;
	return undefined;
}

function isTagAccess(node: ESTree.Expression): boolean {
	if (node.type !== "MemberExpression" || node.computed === true) return false;
	if (node.property.type === "Identifier") return node.property.name === "_tag";
	return node.property.type === "Literal" && node.property.value === "_tag";
}

export const noEffectInternalTagsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow `_tag` equality on Effect-owned data (Option, Either, Result, Exit, Cause).",
		},
		messages: {
			effectInternalTag:
				"Do not match Effect internals on `_tag`. Use Option.isNone, Result.isSuccess, Exit.isFailure, or the matching public helper.",
		},
	},
	create(context) {
		return {
			BinaryExpression(node) {
				if (!["===", "!==", "==", "!="].includes(node.operator)) return;
				const tag = isTagAccess(node.left)
					? literalTag(node.right)
					: isTagAccess(node.right)
						? literalTag(node.left)
						: undefined;
				if (tag === undefined || !INTERNAL_TAGS.has(tag)) return;
				context.report({ node, messageId: "effectInternalTag" });
			},
		};
	},
});
