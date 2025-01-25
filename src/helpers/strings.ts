import MarkdownIt from "markdown-it";
import { TidyURL } from "tidy-url";

const MARKDOWN = new MarkdownIt();

export function renderMarkdown(text: string) {
	return MARKDOWN.render(text);
}
export function cleanUrl(url: string) {
	return TidyURL.clean(url).url;
}