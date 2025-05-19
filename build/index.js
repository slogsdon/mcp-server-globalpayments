import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DOCS_DIR = path.resolve(__dirname, "../docs");
// Create server instance
const server = new McpServer({
    name: "markdown-docs",
    version: "1.0.0",
});
// Helper function to list files recursively
async function listFilesRecursively(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            return listFilesRecursively(fullPath);
        }
        else {
            return fullPath;
        }
    }));
    return files.flat();
}
async function readFile(fileName) {
    const content = await fs.readFile(fileName, "utf-8");
    return content;
}
// Register tools using the `tool` method with debug logging
const listToolDescription = "Lists available documents about the Global Payments API Platform, " +
    "including API specifications, best practices, and suggested workflows. " +
    "These documents are available in Markdown format with related metadata in " +
    "the frontmatter section as YAML. Additionally, these documents are exposed " +
    "as resources in the MCP server, allowing for easy access and retrieval for " +
    "those MCP clients that support it.";
// server.tool("list-markdown-files", listToolDescription, async () => {
//   const files = await listFilesRecursively(DOCS_DIR);
//   return {
//     content: files.filter((file: string) => file.endsWith(".md") || file.endsWith(".yaml"))
//       .map((file: string) => ({ type: "text", text: file.replace(DOCS_DIR, "") })),
//   };
// });
// Alternate implementation: list files from remote sitemap
server.tool("list-sitemap-urls", "Lists files by reading the Global Payments Developer Portal sitemap at https://developer.globalpay.com/sitemap.xml.", async () => {
    const res = await fetch("https://developer.globalpay.com/sitemap.xml");
    if (!res.ok) {
        throw new Error(`Failed to fetch sitemap: ${res.status}`);
    }
    const xml = await res.text();
    const parser = new XMLParser();
    const parsed = parser.parse(xml);
    // Sitemap index or urlset
    const urls = parsed.urlset && parsed.urlset.url
        ? parsed.urlset.url
        : parsed.sitemapindex && parsed.sitemapindex.sitemap
            ? parsed.sitemapindex.sitemap
            : [];
    // urls can be an array or a single object
    const urlList = Array.isArray(urls) ? urls : [urls];
    return {
        content: urlList
            .map((entry) => entry.loc)
            .filter(Boolean)
            .map((loc) => ({ type: "text", text: loc })),
    };
});
// Tool to fetch the content of a remote sitemap URL
server.tool("fetch-sitemap-url", "Fetches the content of a remote Global Payments Developer Portal URL and returns its raw text.", { url: z.string().url() }, async (extra) => {
    const res = await fetch(extra.url);
    if (!res.ok) {
        throw new Error(`Failed to fetch URL: ${res.status}`);
    }
    const html = await res.text();
    // Log first 500 chars of HTML for debugging
    console.error('First 500 chars of HTML:', html);
    // Try both spellings since there might be a typo
    let mainContentIndex = html.indexOf('id="main-content"');
    console.error('main-content index:', mainContentIndex);
    if (mainContentIndex === -1) {
        console.error('Could not find main-content div');
        return {
            content: [{ type: "text", text: "Could not find main-content section" }],
        };
    }
    // Get surrounding context of where we found main-content
    const contextStart = Math.max(0, mainContentIndex - 100);
    const contextEnd = Math.min(html.length, mainContentIndex + 100);
    console.error('Context around main-content:', html.substring(contextStart, contextEnd));
    // Extract with a more precise regex targeting the structure, accounting for both spellings
    const mainContentRegex = /<(?:div|main|section)[^>]+?(?:class="[^"]*"\s+)?id="main-content"[^>]*>([\s\S]*?)<\/(?:div|main|section)>/i;
    console.error('Using regex:', mainContentRegex.source);
    const mainContentMatch = html.match(mainContentRegex);
    if (!mainContentMatch) {
        console.error('Regex failed to match main-content section');
        return {
            content: [{ type: "text", text: "Failed to extract main-content section" }],
        };
    }
    // Clean up the extracted content
    if (mainContentMatch && mainContentMatch[1]) {
        // Clean up the extracted content
        const mainContent = mainContentMatch[1]
            // Remove script tags and their contents
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            // Remove style tags and their contents
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
            // Remove all other HTML tags but keep their content
            .replace(/<[^>]+>/g, '')
            // Remove extra whitespace
            .replace(/\s+/g, ' ')
            .trim();
        return {
            content: [{ type: "text", text: mainContent }],
        };
    }
    // Fall back to full HTML if main-content is not found
    return {
        content: [{ type: "text", text: html }],
    };
});
// server.tool("get-markdown-file", "Gets a specific document about the Global Payments API Platform.", { filename: z.string() }, async (extra) => {
//   return { content: [{type: "text", text: await readFile(DOCS_DIR + "/" + extra.filename) }]};
// });
const files = await listFilesRecursively(DOCS_DIR);
const docs = files.filter((file) => file.endsWith(".md") || file.endsWith(".yaml"))
    .map((file) => file.replace(DOCS_DIR, ""));
docs.forEach(file => {
    server.resource(file, `file://globalpayments${file}`, async (uri) => {
        return {
            contents: [{
                    uri: uri.href,
                    text: await readFile(DOCS_DIR + file),
                }],
        };
    });
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Log server start message
    console.error("Markdown Docs MCP Server running on stdio");
}
main().catch((error) => {
    console.error(`Fatal error in main(): ${error}`);
    process.exit(1);
});
