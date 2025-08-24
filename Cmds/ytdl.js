const ytdl = require('ytdl-core');
const axios = require('axios');

// Cache pour éviter les doublons
const downloadCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const autoDownloadSettings = new Map();

module.exports = async function cmdYouTubeDl(senderId, args, ctx) {
    const { log, sendMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        // Afficher l'aide si aucun argument
        if (!args?.trim()) {
            const helpMsg = `🔴 **Téléchargeur YouTube YTDL**

📗 **Usage :** \`/ytdl [URL_YOUTUBE]\`

**URLs supportées :**
• \`https://www.youtube.com/watch?v=...\`
• \`https://youtu.be/...\`
• \`https://www.youtube.com/shorts/...\`

**Commandes admin :**
• \`/ytdl on\` - Active l'auto-téléchargement
• \`/ytdl off\` - Désactive l'auto-téléchargement

💡 **Exemple :** \`/ytdl https://www.youtube.com/watch?v=dQw4w9WgXcQ\``;

            addToMemory(senderIdStr, 'user', args || '/ytdl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const command = args.trim().toLowerCase();

        // Gestion des paramètres auto-download (Admin seulement)
        if (command === 'on' || command === 'off') {
            if (!isAdmin(senderId)) {
                const noPermMsg = "🚫 Seuls les administrateurs peuvent modifier l'auto-téléchargement !";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noPermMsg);
                return noPermMsg;
            }

            const isEnabled = command === 'on';
            autoDownloadSettings.set(senderIdStr, isEnabled);
            
            const statusMsg = `🔧 Auto-téléchargement YouTube ${isEnabled ? '**activé**' : '**désactivé**'} !`;
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            log.info(`🔧 Auto-download YouTube ${isEnabled ? 'activé' : 'désactivé'} pour ${senderId}`);
            return statusMsg;
        }

        // Validation de l'URL YouTube
        const url = args.trim();
        if (!isValidYouTubeUrl(url)) {
            const invalidMsg = `❌ **URL YouTube invalide !**

📝 **Formats acceptés :**
• \`https://www.youtube.com/watch?v=VIDEO_ID\`
• \`https://youtu.be/VIDEO_ID\`
• \`https://www.youtube.com/shorts/VIDEO_ID\`

💡 **Astuce :** Copiez l'URL directement depuis YouTube !`;

            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', invalidMsg);
            return invalidMsg;
        }

        // Vérification des doublons
        const cacheKey = `${senderIdStr}_${url}`;
        const now = Date.now();
        cleanExpiredCache();
        
        if (downloadCache.has(cacheKey)) {
            const cacheEntry = downloadCache.get(cacheKey);
            const timeElapsed = now - cacheEntry.timestamp;
            
            if (timeElapsed < CACHE_DURATION) {
                const remainingTime = Math.ceil((CACHE_DURATION - timeElapsed) / 1000);
                const duplicateMsg = `🔄 **Téléchargement récent détecté !**

⚠️ Vous avez déjà téléchargé cette vidéo récemment.
⏱️ Vous pourrez la télécharger à nouveau dans **${remainingTime} secondes**.`;

                log.debug(`🔄 Doublon YouTube évité pour ${senderId}: ${shortenUrl(url)}`);
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', duplicateMsg);
                return duplicateMsg;
            }
        }

        // Message de chargement
        const loadingMsg = `⏳ **Téléchargement YouTube en cours...**

📗 URL: ${shortenUrl(url)}
🔴 Extraction des informations vidéo...`;

        addToMemory(senderIdStr, 'user', args);
        await sendMessage(senderId, loadingMsg);

        // Validation et extraction des infos
        if (!ytdl.validateURL(url)) {
            throw new Error('URL YouTube invalide selon ytdl-core');
        }

        log.info(`📡 Extraction infos YouTube: ${shortenUrl(url)}`);
        
        // Options ytdl améliorées pour éviter l'erreur 410
        const ytdlOptions = {
            filter: 'audioandvideo',
            quality: 'highest',
            highWaterMark: 1 << 25, // Évite les coupures
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            }
        };

        const info = await ytdl.getInfo(url, ytdlOptions);
        
        if (!info?.videoDetails) {
            throw new Error('Impossible d\'obtenir les informations de la vidéo');
        }

        const videoDetails = info.videoDetails;
        const title = videoDetails.title;
        const author = videoDetails.author?.name || videoDetails.ownerChannelName;
        const duration = formatDuration(videoDetails.lengthSeconds);
        const viewCount = formatNumber(videoDetails.viewCount);

        log.info(`✅ Infos extraites: "${title}" par ${author}`);

        // Sélection du meilleur format (corrigé pour éviter 410)
        const format = selectBestFormat(info.formats);
        
        if (!format?.url) {
            throw new Error('Aucun format de téléchargement disponible');
        }

        log.info(`🎬 Format sélectionné: ${format.qualityLabel || format.quality} (${format.container || 'unknown'})`);

        // Ajouter au cache
        downloadCache.set(cacheKey, {
            timestamp: now,
            title: title,
            author: author,
            videoId: videoDetails.videoId
        });

        // Message de résultat
        const resultMessage = `✅ **Téléchargement YouTube terminé !**

🎬 **Titre :** ${cleanText(title, 80)}
📺 **Chaîne :** ${cleanText(author, 50)}
${duration ? `⏱️ **Durée :** ${duration}\n` : ''}${viewCount ? `👀 **Vues :** ${viewCount}\n` : ''}🎯 **Qualité :** ${format.qualityLabel || format.quality}
📱 **Demandé par :** User ${senderId}

💕 **Téléchargé avec amour par NakamaBot !**`;

        // Téléchargement et envoi
        try {
            log.info(`📤 Tentative d'envoi du média YouTube...`);
            
            const videoResult = await sendVideoMessage(senderId, format.url, resultMessage, ctx);
            
            if (videoResult.success) {
                addToMemory(senderIdStr, 'assistant', resultMessage);
                log.info(`✅ Vidéo YouTube téléchargée avec succès pour ${senderId}`);
                return { type: 'media_sent', success: true };
            } else {
                throw new Error('Envoi vidéo échoué');
            }
        } catch (sendError) {
            log.warn(`⚠️ Échec envoi vidéo YouTube: ${sendError.message}`);
            
            // Fallback: envoyer le lien direct
            const fallbackMsg = `🔗 **Lien de téléchargement YouTube direct :**

📗 ${format.url}

🎬 **Titre :** ${cleanText(title, 60)}
📺 **Chaîne :** ${cleanText(author, 40)}
${duration ? `⏱️ **Durée :** ${duration}\n` : ''}🎯 **Qualité :** ${format.qualityLabel || format.quality}

📱 Cliquez sur le lien pour télécharger la vidéo !`;

            addToMemory(senderIdStr, 'assistant', fallbackMsg);
            return fallbackMsg;
        }

    } catch (ytdlError) {
        log.error(`❌ Erreur YTDL pour ${senderId}: ${ytdlError.message}`);
        
        // Supprimer du cache en cas d'erreur
        const cacheKey = `${senderIdStr}_${args?.trim()}`;
        downloadCache.delete(cacheKey);
        
        let errorMsg = "❌ **Échec du téléchargement YouTube**\n\n";
        
        if (ytdlError.statusCode === 410 || ytdlError.message.includes('410')) {
            errorMsg += "🚫 **Erreur 410 :** La ressource n'est plus disponible\n";
            errorMsg += "💡 **Solutions :**\n";
            errorMsg += "   • Le format demandé a expiré (YouTube change souvent les URLs)\n";
            errorMsg += "   • Réessayez dans quelques secondes\n";
            errorMsg += "   • Utilisez `/alldl` comme alternative";
        } else if (ytdlError.message.includes('Video unavailable')) {
            errorMsg += "🚫 **Erreur :** Vidéo non disponible\n";
            errorMsg += "   • La vidéo est privée, supprimée ou restreinte\n";
            errorMsg += "   • Restriction géographique possible";
        } else if (ytdlError.message.includes('Sign in to confirm')) {
            errorMsg += "🔞 **Erreur :** Vérification d'âge requise\n";
            errorMsg += "   • Cette vidéo nécessite une connexion YouTube";
        } else if (ytdlError.message.includes('rate limit') || ytdlError.message.includes('429')) {
            errorMsg += "🚦 **Erreur :** Limite de taux atteinte\n";
            errorMsg += "   • Attendez 5-10 minutes avant de réessayer";
        } else {
            errorMsg += `🐛 **Erreur technique :** ${ytdlError.message.substring(0, 100)}\n`;
            errorMsg += "💡 **Solutions générales :**\n";
            errorMsg += "   • Vérifiez l'URL YouTube\n";
            errorMsg += "   • Réessayez dans quelques minutes\n";
            errorMsg += "   • Utilisez `/alldl` comme alternative";
        }
        
        errorMsg += `\n📗 **URL testée :** ${shortenUrl(args?.trim())}`;

        addToMemory(senderIdStr, 'assistant', errorMsg);
        return errorMsg;
    }
};

// === FONCTIONS UTILITAIRES ===

function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{11}(\S+)?$/;
    return youtubeRegex.test(url);
}

function selectBestFormat(formats) {
    if (!formats?.length) return null;
    
    // Filtrer les formats valides avec audio et vidéo
    const validFormats = formats.filter(f => 
        f.hasVideo && 
        f.hasAudio && 
        f.url &&
        !f.isLive &&
        f.container !== 'webm' // Préférer MP4
    );
    
    if (validFormats.length > 0) {
        // Préférer dans l'ordre: 720p, 480p, 360p, puis le premier disponible
        return validFormats.find(f => f.qualityLabel === '720p') ||
               validFormats.find(f => f.qualityLabel === '480p') ||
               validFormats.find(f => f.qualityLabel === '360p') ||
               validFormats[0];
    }
    
    // Fallback: audio seulement
    const audioFormats = formats.filter(f => f.hasAudio && !f.hasVideo && f.url);
    if (audioFormats.length > 0) {
        return audioFormats.find(f => f.audioBitrate) || audioFormats[0];
    }
    
    // Dernier recours
    return formats.find(f => f.url) || null;
}

function formatDuration(seconds) {
    if (!seconds) return null;
    const sec = parseInt(seconds);
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const remainingSeconds = sec % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
    if (!num) return null;
    const number = parseInt(num);
    if (number >= 1000000) return (number / 1000000).toFixed(1) + 'M';
    if (number >= 1000) return (number / 1000).toFixed(1) + 'K';
    return number.toString();
}

function shortenUrl(url) {
    if (!url) return 'URL manquante';
    return url.length > 60 ? url.substring(0, 60) + '...' : url;
}

function cleanText(text, maxLength = 100) {
    if (!text) return 'Non disponible';
    return text.replace(/[^\w\s\-\.,!?()\[\]]/g, '').substring(0, maxLength).trim();
}

function cleanExpiredCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, entry] of downloadCache.entries()) {
        if (now - entry.timestamp > CACHE_DURATION) {
            expiredKeys.push(key);
        }
    }
    
    expiredKeys.forEach(key => downloadCache.delete(key));
    
    if (expiredKeys.length > 0) {
        console.log(`🧹 Cache YouTube nettoyé: ${expiredKeys.length} entrées expirées`);
    }
}

async function sendVideoMessage(recipientId, videoUrl, caption = "", ctx) {
    const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
    
    if (!PAGE_ACCESS_TOKEN) {
        return { success: false, error: "No token" };
    }
    
    const data = {
        recipient: { id: String(recipientId) },
        message: {
            attachment: {
                type: "video",
                payload: {
                    url: videoUrl,
                    is_reusable: false
                }
            }
        }
    };
    
    try {
        const response = await axios.post(
            "https://graph.facebook.com/v18.0/me/messages",
            data,
            {
                params: { access_token: PAGE_ACCESS_TOKEN },
                timeout: 45000
            }
        );
        
        if (response.status === 200) {
            if (caption && ctx.sendMessage) {
                await new Promise(resolve => setTimeout(resolve, 1500));
                await ctx.sendMessage(recipientId, caption);
            }
            return { success: true };
        }
        return { success: false, error: `API Error ${response.status}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// Auto-download handler
async function handleYouTubeAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}(?:\S+)?)/gi;
    const urls = messageText.match(youtubeRegex);
    
    if (urls?.length > 0) {
        const url = urls[0];
        try {
            ctx.log.info(`🔴 Auto-téléchargement YouTube déclenché pour ${senderId}: ${shortenUrl(url)}`);
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            ctx.log.warn(`⚠️ Erreur auto-download YouTube: ${error.message}`);
        }
    }
    return false;
}

// Exports
module.exports.handleYouTubeAutoDownload = handleYouTubeAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidYouTubeUrl = isValidYouTubeUrl;
