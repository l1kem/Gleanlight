/** 无自带类型的三方依赖声明 */
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const taskLists: MarkdownIt.PluginWithOptions;
  export default taskLists;
}
declare module "markdown-it-footnote" {
  import type MarkdownIt from "markdown-it";
  const footnote: MarkdownIt.PluginWithOptions;
  export default footnote;
}
declare module "markdown-it-texmath" {
  import type MarkdownIt from "markdown-it";
  const texmath: MarkdownIt.PluginWithOptions;
  export default texmath;
}
