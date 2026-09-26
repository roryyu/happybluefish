/** 文档目录中一篇 markdown 文章的元信息（由服务端扫描 public/docs 生成） */
export interface DocMeta {
  /** 文件名（含 .md 后缀），同时作为客户端拉取静态文件的标识 */
  file: string;
  /** 文章标题：取自正文首个一级标题，缺失时回退为文件名 */
  title: string;
  /** 首个普通段落摘要，用于目录列表展示 */
  excerpt: string;
  /** 文件最后修改时间（ISO 字符串） */
  updatedAt: string;
  /** 正文字符数（约等于中文字数） */
  chars: number;
}
