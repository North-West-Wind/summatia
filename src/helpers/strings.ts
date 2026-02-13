import normalizeUrl from "normalize-url";
import MarkdownIt from "markdown-it";

const MARKDOWN = new MarkdownIt();

export function renderMarkdown(text: string) {
	return MARKDOWN.render(text);
}
export function cleanUrl(url: string) {
	return normalizeUrl(url);
}