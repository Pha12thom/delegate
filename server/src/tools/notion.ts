/**
 * Notion Tool
 *
 * All methods receive a vault_token fetched from Auth0 Token Vault.
 * Uses Notion's public API (v1).
 */

import axios from "axios";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionClient(token: string) {
  return axios.create({
    baseURL: NOTION_API,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
  });
}

export interface NotionPage {
  id: string;
  title: string;
  url: string;
  created_time: string;
  last_edited_time: string;
}

export interface NotionDatabase {
  id: string;
  title: string;
  url: string;
}

/**
 * List databases the user has access to.
 */
export async function listDatabases(token: string): Promise<NotionDatabase[]> {
  const client = notionClient(token);
  const { data } = await client.post("/search", {
    filter: { value: "database", property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    page_size: 20,
  });

  return data.results.map((db: any) => ({
    id: db.id,
    title: db.title?.[0]?.plain_text || "Untitled",
    url: db.url,
  }));
}

/**
 * Search for pages by title.
 */
export async function searchPages(
  token: string,
  query: string
): Promise<NotionPage[]> {
  const client = notionClient(token);
  const { data } = await client.post("/search", {
    query,
    filter: { value: "page", property: "object" },
    sort: { direction: "descending", timestamp: "last_edited_time" },
    page_size: 10,
  });

  return data.results.map((page: any) => ({
    id: page.id,
    title:
      page.properties?.title?.title?.[0]?.plain_text ||
      page.properties?.Name?.title?.[0]?.plain_text ||
      "Untitled",
    url: page.url,
    created_time: page.created_time,
    last_edited_time: page.last_edited_time,
  }));
}

/**
 * Create a new page in the user's workspace (as a top-level page or in a parent).
 */
export async function createPage(
  token: string,
  title: string,
  content: string,
  options: { parentPageId?: string; parentDatabaseId?: string } = {}
): Promise<NotionPage> {
  const client = notionClient(token);

  // Determine parent
  let parent: object;
  if (options.parentDatabaseId) {
    parent = { database_id: options.parentDatabaseId };
  } else if (options.parentPageId) {
    parent = { page_id: options.parentPageId };
  } else {
    // Top-level page in workspace — requires workspace access
    parent = { type: "workspace", workspace: true };
  }

  // Convert plain text content into Notion blocks (paragraphs, headings)
  const blocks = contentToBlocks(content);

  const { data } = await client.post("/pages", {
    parent,
    properties: {
      title: {
        title: [{ type: "text", text: { content: title } }],
      },
    },
    children: blocks,
  });

  return {
    id: data.id,
    title,
    url: data.url,
    created_time: data.created_time,
    last_edited_time: data.last_edited_time,
  };
}

/**
 * Append content blocks to an existing page.
 */
export async function appendToPage(
  token: string,
  pageId: string,
  content: string
): Promise<void> {
  const client = notionClient(token);
  const blocks = contentToBlocks(content);
  await client.patch(`/blocks/${pageId}/children`, { children: blocks });
}

/**
 * Get the text content of a page.
 */
export async function getPageContent(
  token: string,
  pageId: string
): Promise<string> {
  const client = notionClient(token);
  const { data } = await client.get(`/blocks/${pageId}/children`);

  return data.results
    .map((block: any) => {
      const type = block.type;
      const richText = block[type]?.rich_text || [];
      return richText.map((t: any) => t.plain_text).join("");
    })
    .filter(Boolean)
    .join("\n");
}

// ─── Helpers ──────────────────────────────────────────

function contentToBlocks(content: string): object[] {
  const lines = content.split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    if (line.startsWith("# ")) {
      return heading(1, line.slice(2));
    } else if (line.startsWith("## ")) {
      return heading(2, line.slice(3));
    } else if (line.startsWith("### ")) {
      return heading(3, line.slice(4));
    } else if (line.startsWith("- ") || line.startsWith("• ")) {
      return bulletItem(line.slice(2));
    } else if (/^\d+\.\s/.test(line)) {
      return numberedItem(line.replace(/^\d+\.\s/, ""));
    } else {
      return paragraph(line);
    }
  });
}

function richText(text: string) {
  return [{ type: "text", text: { content: text } }];
}

function paragraph(text: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(text) } };
}

function heading(level: 1 | 2 | 3, text: string) {
  const type = `heading_${level}` as const;
  return { object: "block", type, [type]: { rich_text: richText(text) } };
}

function bulletItem(text: string) {
  return {
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(text) },
  };
}

function numberedItem(text: string) {
  return {
    object: "block",
    type: "numbered_list_item",
    numbered_list_item: { rich_text: richText(text) },
  };
}
