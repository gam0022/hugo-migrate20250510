const fs = require('fs').promises;
const path = require('path');
const toml = require('toml');
const yaml = require('js-yaml');

// ディレクトリ設定
const oldContentDir = 'D:\\gam0022.github.com-source-hugo\\content\\post';
const oldImagesDir = 'D:\\gam0022.github.com-source-hugo\\static\\images\\posts';
const newContentDir = 'D:\\theme-academic-cv\\content\\post';

// 画像および動画ファイルの拡張子
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'];

// ファイル名からslugとディレクトリ名を抽出する関数
function extractMetadataFromFileName(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const baseName = path.basename(fileName, ext);
    // 日付プレフィックス（YYYY-MM-DD-）を削除してslugを生成
    const slug = baseName.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    // ディレクトリ名は日付プレフィックスを含む
    const dirName = baseName;
    return { slug, dirName };
}

// マークダウンをプレーンテキストに変換する関数
function markdownToPlainText(markdown) {
    if (!markdown) return '';
    let text = markdown;
    // インラインリンク: [text](url) → text
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 画像/動画: ![alt](url) → alt
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 太字: **text** or __text__ → text
    text = text.replace(/(?:\*\*|__)(.*?)(?:\*\*|__)/g, '$1');
    // 斜体: *text* or _text_ → text
    text = text.replace(/(?:\*|_)(.*?)(?:\*|_)/g, '$1');
    // コード: `code` → code
    text = text.replace(/`([^`]+)`/g, '$1');
    // HTMLタグを除去
    text = text.replace(/<[^>]+>/g, '');
    // 連続するスペースを単一スペースに
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

// フロントマターを抽出する関数（TOMLまたはYAML対応）
function extractFrontMatter(content) {
    const lines = content.split('\n');
    let frontmatter = [];
    let body = [];
    let inFrontMatter = false;
    let foundFirstDelimiter = false;
    let delimiter = null; // '+++' または '---'

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine === '+++' || trimmedLine === '---') {
            if (!foundFirstDelimiter) {
                delimiter = trimmedLine;
                foundFirstDelimiter = true;
                inFrontMatter = true;
                console.log(`Debug: Detected delimiter for first time: ${delimiter}`);
                continue;
            } else if (inFrontMatter && trimmedLine === delimiter) {
                inFrontMatter = false;
                console.log(`Debug: Detected closing delimiter: ${delimiter}`);
                continue;
            } else if (inFrontMatter && trimmedLine !== delimiter) {
                console.warn(`Warning: Mismatched delimiter detected: expected ${delimiter}, got ${trimmedLine}`);
            }
        }

        if (inFrontMatter) {
            frontmatter.push(line);
        } else {
            body.push(line);
        }
    }

    if (foundFirstDelimiter && !inFrontMatter) {
        // フロントマターの末尾に改行を追加
        const frontmatterText = frontmatter.join('\n') + '\n';
        const format = delimiter === '+++' ? 'TOML' : 'YAML';
        console.log(`Debug: Determined frontmatter format: ${format}`);
        return { frontmatter: frontmatterText, body: body.join('\n'), format };
    }
    console.log(`Debug: No valid frontmatter found`);
    return { frontmatter: null, body: content, format: null };
}

// ディレクトリを作成するヘルパー関数
async function ensureDir(dir) {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
}

// 記事のサブディレクトリから画像/動画をコピーする関数（ディレクトリ構造を維持）
async function moveImagesForPost(dirName, slug, metadata) {
    const oldImagesPostDir = path.join(oldImagesDir, dirName);
    const newImagesPostDir = path.join(newContentDir, dirName);

    // 再帰的にサブディレクトリ内の画像/動画をコピー
    async function copyImagesRecursively(srcDir, destDir) {
        try {
            const entries = await fs.readdir(srcDir, { withFileTypes: true });
            for (const entry of entries) {
                const srcPath = path.join(srcDir, entry.name);
                const destPath = path.join(destDir, entry.name);
                if (entry.isDirectory()) {
                    await ensureDir(destPath);
                    await copyImagesRecursively(srcPath, destPath);
                } else if (imageExtensions.includes(path.extname(entry.name).toLowerCase())) {
                    try {
                        await fs.copyFile(srcPath, destPath);
                        console.log(`Debug: Copied file ${srcPath} to ${destPath}`);
                    } catch (imgErr) {
                        console.warn(`Warning: Failed to copy file ${srcPath}. Error: ${imgErr.message}`);
                    }
                }
            }
        } catch (err) {
            if (err.code !== 'ENOENT') {
                console.warn(`Warning: Error accessing directory ${srcDir}: ${err.message}`);
            }
        }
    }

    // デフォルトのディレクトリをチェック
    try {
        console.log(`Debug: Checking images/videos directory at ${oldImagesPostDir}`);
        await fs.access(oldImagesPostDir);
        await ensureDir(newImagesPostDir);
        await copyImagesRecursively(oldImagesPostDir, newImagesPostDir);
        return; // コピーが成功したら終了
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`Warning: Error accessing images/videos for ${dirName}: ${err.message}`);
            return;
        }
        console.log(`Debug: No images/videos directory found at ${oldImagesPostDir}. Attempting to derive path from metadata.image...`);
    }

    // metadata.imageからディレクトリ名を抽出
    if (metadata.image && typeof metadata.image === 'string' && metadata.image.trim()) {
        const imagePathParts = metadata.image.replace(/^\/?(?:images\/posts\/)?/, '').split('/');
        if (imagePathParts.length === 1) {
            // 直接ファイルの場合（例：2016-12-28-emsn2.png）
            const directImagePath = path.join(oldImagesDir, imagePathParts[0]);
            console.warn(`Warning: Image file for ${dirName} is directly in posts directory at ${directImagePath} instead of a subdirectory: ${metadata.image}`);
        } else {
            // サブディレクトリの場合（例：2025-04-12-draw2/subdir/ogp.jpg）
            const derivedDirName = imagePathParts[0]; // 例: '2025-04-12-draw2'
            const derivedImagesDir = path.join(oldImagesDir, derivedDirName);

            try {
                console.log(`Debug: Trying derived images/videos directory from metadata.image: ${derivedImagesDir}`);
                await fs.access(derivedImagesDir);
                await ensureDir(newImagesPostDir);
                await copyImagesRecursively(derivedImagesDir, newImagesPostDir);
                console.log(`Debug: Successfully copied from derived directory ${derivedImagesDir}`);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    console.log(`Debug: No images/videos directory found for ${dirName} at ${oldImagesPostDir} or derived path ${derivedImagesDir}`);
                } else {
                    console.warn(`Warning: Error accessing derived images/videos directory ${derivedImagesDir}: ${err.message}`);
                }
            }
        }
    } else {
        console.log(`Debug: No valid metadata.image to derive directory for ${dirName}. Skipping copy.`);
    }
}

// Markdownファイルを変換し、内容を修正
async function convertMarkdown(filePath, fileName) {
    try {
        const content = await fs.readFile(filePath, 'utf8');

        // デバッグ用: ファイルの先頭10行をログ出力
        const firstLines = content.split('\n').slice(0, 10).join('\n');
        console.log(`Debug: First 10 lines of ${fileName}:\n${firstLines}\n`);

        // フロントマターを抽出
        const { frontmatter, body, format } = extractFrontMatter(content);

        let metadata = {};

        // ファイル名からslugとディレクトリ名を生成
        const { slug: generatedSlug, dirName } = extractMetadataFromFileName(fileName);

        // フロントマターが存在しない場合の処理
        if (!frontmatter) {
            console.warn(`Warning: No frontmatter found in ${fileName}. Generating default metadata...`);
            metadata = {
                title: generatedSlug,
                slug: generatedSlug,
                date: new Date().toISOString(),
                tags: [],
            };
        } else {
            try {
                console.log(`Debug: Raw frontmatter for ${fileName}:\n${frontmatter}\n`);
                if (format === 'TOML') {
                    metadata = toml.parse(frontmatter);
                } else if (format === 'YAML') {
                    metadata = yaml.load(frontmatter);
                }
                console.log(`Debug: Parsed frontmatter for ${fileName}:`, JSON.stringify(metadata, null, 2));
            } catch (parseErr) {
                console.warn(`Warning: Failed to parse ${format || 'unknown'} frontmatter in ${fileName}. Error: ${parseErr.message}. Generating default metadata...`);
                metadata = {
                    title: generatedSlug,
                    slug: generatedSlug,
                    date: new Date().toISOString(),
                    tags: [],
                };
            }
        }

        // 必須フィールドの設定
        metadata.title = metadata.title || generatedSlug;
        metadata.slug = metadata.slug || generatedSlug;
        metadata.date = metadata.date || new Date().toISOString();
        metadata.tags = metadata.tags || [];

        // summaryを最初の非見出しの非空行から生成
        let rawSummary = 'No summary available';
        const lines = body.split('\n');
        for (const line of lines) {
            if (line.trim() && !line.trim().startsWith('#')) {
                rawSummary = line.trim();
                break;
            } else if (line.trim().startsWith('#')) {
                console.log(`Debug: Skipping heading for summary in ${fileName}: ${line.trim()}`);
            }
        }
        const plainSummary = markdownToPlainText(rawSummary);
        console.log(`Debug: Raw summary for ${fileName}: ${rawSummary}`);
        console.log(`Debug: Plain text summary for ${fileName}: ${plainSummary}`);

        // 新しいメタデータを作成（YAML形式で出力）
        const newMetadata = {
            title: metadata.title,
            slug: metadata.slug,
            summary: plainSummary,
            date: metadata.date,
            tags: metadata.tags,
            authors: ['admin'],
        };

        // image.filename に相対パスを設定（画像コピーはしない）
        if (metadata.image && typeof metadata.image === 'string' && metadata.image.trim()) {
            console.log(`Debug: metadata.image value for ${fileName}: ${metadata.image}`);
            const relativeImagePath = metadata.image.replace(/^\/?(?:images\/posts\/)?/, '');
            // image.filename に相対パスを設定（サブディレクトリがない場合はファイル名のみ）
            const filenameRelativePath = relativeImagePath.includes('/') ? relativeImagePath.replace(/^[^\/]+\//, '') : relativeImagePath;
            newMetadata.image = { filename: filenameRelativePath };
            console.log(`Debug: Set image.filename for ${fileName}: ${filenameRelativePath}`);
        } else {
            console.log(`Debug: No valid metadata.image for ${fileName}`);
        }

        // 画像/動画パスをindex.mdからの相対パスに修正し、見出しレベルを1段階下げる
        let updatedBody = body
            .replace(/!\[(.*?)\]\((\/(?:images\/posts\/)?[^)]+)\)/g, (match, alt, src) => {
                // 画像URLが /images/posts/ 直下のファイルか、またはサブディレクトリが一致しないかチェック
                const urlPathParts = src.replace(/^\/?(?:images\/posts\/)?/, '').split('/');
                if (urlPathParts.length === 1) {
                    const imagePath = path.join(oldImagesDir, urlPathParts[0]);
                    console.warn(`Warning: Image URL in ${fileName} is directly in posts directory at ${imagePath} instead of a subdirectory: ${src}`);
                } else if (urlPathParts.length > 1) {
                    const urlSubdir = urlPathParts[0];
                    if (urlSubdir !== dirName) {
                        console.warn(`Warning: Image URL in ${fileName} has a mismatched subdirectory ${urlSubdir} (expected ${dirName}): ${src}`);
                    }
                }
                // サブディレクトリ構造を維持した相対パスに変換
                const relativePath = src.replace(/^\/?(?:images\/posts\/)?[^\/]*\//, '');
                console.log(`Debug: Converting media path for ${fileName}: ${src} -> ${relativePath}`);
                return `![${alt}](${relativePath})`;
            })
            .replace(/\[(.*?)\]\((\/(?:images\/posts\/)?[^)]+)\)/g, (match, text, src) => {
                // サブディレクトリ構造を維持した相対パスに変換
                const relativePath = src.replace(/^\/?(?:images\/posts\/)?[^\/]*\//, '');
                console.log(`Debug: Converting link path for ${fileName}: ${src} -> ${relativePath}`);
                return `[${text}](${relativePath})`;
            })
            .replace(/^(#+) (.*)$/gm, (match, hashes, content) => {
                // 見出しレベルを1段階下げる（H6は変更しない）
                const newHashes = hashes.length < 6 ? hashes + '#' : hashes;
                console.log(`Debug: Converting heading for ${fileName}: ${match} -> ${newHashes} ${content}`);
                return `${newHashes} ${content}`;
            });

        // 新しいメタデータをYAMLに変換
        const yamlMetadata = yaml.dump(newMetadata, { lineWidth: -1 });
        const newContent = `---\n${yamlMetadata}---\n\n${updatedBody}`;

        // 新しいディレクトリに保存（日付プレフィックスを含む）
        const newDir = path.join(newContentDir, dirName);
        await ensureDir(newDir);
        await fs.writeFile(path.join(newDir, 'index.md'), newContent, 'utf8');

        // 記事のサブディレクトリから画像/動画をコピー（metadataを渡す）
        await moveImagesForPost(dirName, metadata.slug, metadata);

        console.log(`Successfully processed: ${fileName}`);
    } catch (err) {
        console.error(`Error processing ${fileName}: ${err.message}`);
    }
}

// メイン処理
async function main() {
    try {
        // Markdownファイルを処理
        const files = await fs.readdir(oldContentDir);
        if (files.length === 0) {
            console.warn(`Warning: No files found in ${oldContentDir}`);
        }
        for (const file of files) {
            const ext = path.extname(file).toLowerCase();
            if (ext === '.md' || ext === '.markdown') {
                console.log(`Debug: Processing file with extension: ${ext}`);
                const filePath = path.join(oldContentDir, file);
                await convertMarkdown(filePath, file);
            }
        }
        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Error during migration:', err);
    }
}

main();