const fs = require('fs').promises;
const path = require('path');
const toml = require('toml');
const yaml = require('js-yaml');

// ディレクトリ設定
const oldContentDir = 'D:\\gam0022.github.com-source-hugo\\content\\post';
const oldImagesDir = 'D:\\gam0022.github.com-source-hugo\\static\\images\\posts';
const newContentDir = 'D:\\theme-academic-cv\\content\\post';

// ファイル名からslugとディレクトリ名を抽出する関数
function extractMetadataFromFileName(fileName) {
    const baseName = path.basename(fileName, '.md');
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
    // 画像: ![alt](url) → alt
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

// フロントマターを抽出する関数（1行ずつ読み込み）
function extractFrontMatter(content) {
    const lines = content.split('\n');
    let frontmatter = [];
    let body = [];
    let inFrontMatter = false;
    let foundFirstDelimiter = false;

    for (const line of lines) {
        if (line.trim() === '+++') {
            if (!foundFirstDelimiter) {
                foundFirstDelimiter = true;
                inFrontMatter = true;
                continue;
            } else if (inFrontMatter) {
                inFrontMatter = false;
                continue;
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
        return { frontmatter: frontmatterText, body: body.join('\n') };
    }
    return { frontmatter: null, body: content };
}

// ディレクトリを作成するヘルパー関数
async function ensureDir(dir) {
    try {
        await fs.mkdir(dir, { recursive: true });
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
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
        const { frontmatter, body } = extractFrontMatter(content);

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
                // TOMLパース前に文字列を検証
                console.log(`Debug: Raw TOML for ${fileName}:\n${frontmatter}\n`);
                metadata = toml.parse(frontmatter);
                console.log(`Debug: Parsed TOML metadata for ${fileName}:`, JSON.stringify(metadata, null, 2));
            } catch (tomlErr) {
                console.warn(`Warning: Invalid TOML in ${fileName}. Error: ${tomlErr.message}. Generating default metadata...`);
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

        // summaryをマークダウンからプレーンテキストに変換
        const rawSummary = body.split('\n').filter(line => line.trim())[0]?.trim() || 'No summary available';
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

        // 画像の処理（imageフィールドがあればfeatured.jpgにリネーム）
        let featuredImage = '';
        if (metadata.image) {
            const imagePath = path.join(oldImagesDir, metadata.image.replace('/images/posts/', ''));
            const imageFileName = path.basename(imagePath);
            const imageExt = path.extname(imageFileName);
            featuredImage = `featured${imageExt}`; // featured.jpg or featured.png
            const newImagePath = path.join(newContentDir, dirName, featuredImage);
            await ensureDir(path.dirname(newImagePath));
            try {
                await fs.copyFile(imagePath, newImagePath);
                console.log(`Debug: Copied featured image ${imagePath} to ${newImagePath}`);
            } catch (imgErr) {
                console.warn(`Warning: Failed to copy image ${imagePath} for ${fileName}. Error: ${imgErr.message}`);
            }
        }

        // 画像パスを相対パスに修正し、見出しレベルを調整
        let updatedBody = body
            .replace(/!\[(.*?)\]\((\/images\/posts\/.*?)\)/g, (match, alt, src) => {
                const imageName = path.basename(src);
                return `![${alt}](/${dirName}/${imageName})`;
            })
            .replace(/^# /gm, '## '); // 見出しレベルを#から##に変更

        // 新しいメタデータをYAMLに変換
        const yamlMetadata = yaml.dump(newMetadata, { lineWidth: -1 });
        const newContent = `---\n${yamlMetadata}---\n\n${updatedBody}`;

        // 新しいディレクトリに保存（日付プレフィックスを含む）
        const newDir = path.join(newContentDir, dirName);
        await ensureDir(newDir);
        await fs.writeFile(path.join(newDir, 'index.md'), newContent, 'utf8');

        // 対応する画像を移動
        await moveImagesForPost(dirName, metadata.slug);

        console.log(`Successfully processed: ${fileName}`);
    } catch (err) {
        console.error(`Error processing ${fileName}: ${err.message}`);
    }
}

// 画像を移動する関数
async function moveImagesForPost(dirName, slug) {
    const oldImagesPostDir = path.join(oldImagesDir, slug);
    const newImagesPostDir = path.join(newContentDir, dirName);

    // 記事ごとのサブディレクトリに画像がある場合
    try {
        const subDirs = await fs.readdir(oldImagesPostDir, { withFileTypes: true });
        for (const subDir of subDirs) {
            if (subDir.isDirectory()) {
                const subDirPath = path.join(oldImagesDir, subDir.name);
                const images = await fs.readdir(subDirPath);
                for (const image of images) {
                    const oldImagePath = path.join(subDirPath, image);
                    const newImagePath = path.join(newImagesPostDir, image);
                    try {
                        await fs.copyFile(oldImagePath, newImagePath);
                        console.log(`Debug: Copied image ${oldImagePath} to ${newImagePath}`);
                    } catch (imgErr) {
                        console.warn(`Warning: Failed to copy image ${oldImagePath}. Error: ${imgErr.message}`);
                    }
                }
            }
        }
    } catch (err) {
        // サブディレクトリがない場合はスキップ
        if (err.code !== 'ENOENT') {
            console.warn(`Warning: Error accessing subdirectories for ${slug}: ${err.message}`);
        }
    }

    // ルートディレクトリにある画像を移動
    try {
        const allImages = await fs.readdir(oldImagesDir, { withFileTypes: true });
        for (const dirent of allImages) {
            if (dirent.isFile() && dirent.name.includes(slug)) {
                const oldImagePath = path.join(oldImagesDir, dirent.name);
                const newImagePath = path.join(newImagesPostDir, dirent.name);
                try {
                    await fs.copyFile(oldImagePath, newImagePath);
                    console.log(`Debug: Copied image ${oldImagePath} to ${newImagePath}`);
                } catch (imgErr) {
                    console.warn(`Warning: Failed to copy image ${oldImagePath}. Error: ${imgErr.message}`);
                }
            }
        }
    } catch (err) {
        console.warn(`Warning: Error accessing images for ${slug}: ${err.message}`);
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
            if (path.extname(file) === '.md') {
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