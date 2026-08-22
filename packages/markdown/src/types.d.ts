/** 无自带类型的三方依赖声明 */
declare module "markdown-it-task-lists" {
  import type MarkdownIt from "markdown-it";
  const taskLists: MarkdownIt.PluginWithOptions;
  export default taskLists;
}
