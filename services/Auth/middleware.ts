import { api, APIError } from 'encore.dev/api';
import * as path from 'path';
import * as fs from 'fs/promises';
import { fileURLToPath } from 'url';

// Get the directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ExportFileResponse {
    body: any;
    contentType: string;
    headers?: Record<string, string>;
}

// Make sure NodeJS types are properly included
/// <reference types="node" />

// Middleware to serve exported files
export const serveExportFile = api(
    { expose: true, method: "GET", path: "/exports/:filename" },
    async ({ filename }: { filename: string }): Promise<ExportFileResponse> => {
        const exportDir = path.join(__dirname, '../../exports');
        const filePath = path.join(exportDir, filename);

        try {
            // Check if file exists and is within exports directory
            if (!filePath.startsWith(exportDir)) {
                throw APIError.invalidArgument('Invalid file path');
            }

            const fileContent = await fs.readFile(filePath, 'utf-8');
            const jsonContent = JSON.parse(fileContent);
            
            return {
                body: jsonContent,
                contentType: 'application/json',
                headers: {
                    'Content-Disposition': `attachment; filename="${filename}"`
                }
            };
        } catch (error) {
            console.error('Error serving export file:', error);
            if (error instanceof Error) {
                throw APIError.notFound(`File not found or access denied: ${error.message}`);
            }
            throw APIError.internal('An unexpected error occurred while serving the file');
        }
    }
);