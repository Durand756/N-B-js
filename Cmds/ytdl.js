/**
 * Commande YTDL - Téléchargement spécifique YouTube SANS API KEY
 * Utilise ytdl-core pour extraire directement les URLs de téléchargement
 * Avec système d'auto-téléchargement et anti-doublons
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - URL YouTube ou paramètres (on/off pour auto-download)
 * @param {object} ctx - Contexte du bot
 */

const ytdl = require('ytdl-core');

// Stockage local des paramètres d'auto-téléchargement par utilisateur/groupe
const autoDownloadSettings = new Map();

// Cache pour éviter les doublons (URL + UserID)
const downloadCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes en millisecondes

module.exports = async function cmdYouTubeDl(senderId, args, ctx) {
    const { log, sendMessage, sendImageMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        if (!args || !args.trim()) {
            const helpMsg = `🔴 **Téléchargeur YouTube YTDL**

🔗 **Usage :** \`/ytdl [URL_YOUTUBE]\`

**URLs supportées :**
• \`https://www.youtube.com/watch?v=...\`
• \`https://youtu.be/...\`
• \`https://www.youtube.com/shorts/...\`
• \`https://music.youtube.com/watch?v=...\`

**Commandes admin :**
• \`/ytdl on\` - Active l'auto-téléchargement YouTube
• \`/ytdl off\` - Désactive l'auto-téléchargement YouTube

**Qualités disponibles :**
📹 Vidéo: 720p, 480p, 360p (automatique selon disponibilité)
🎵 Audio: MP3 haute qualité

💡 **Exemple :** \`/ytdl https://www.youtube.com/watch?v=dQw4w9WgXcQ\`

⚡ **Avantage :** Pas de limite d'API, téléchargement direct !`;

            addToMemory(senderIdStr, 'user', args || '/ytdl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const command = args.trim().toLowerCase();

        // GESTION DES PARAMÈTRES AUTO-DOWNLOAD (Admin seulement)
        if (command === 'on' || command === 'off') {
            if (!isAdmin(senderId)) {
                const noPermMsg = "🚫 Seuls les administrateurs peuvent modifier l'auto-téléchargement YouTube !";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noPermMsg);
                return noPermMsg;
            }

            const isEnabled = command === 'on';
            autoDownloadSettings.set(senderIdStr, isEnabled);
            
            const statusMsg = `🔧 Auto-téléchargement YouTube ${isEnabled ? '**activé**' : '**désactivé**'} !

${isEnabled ? '✅ Toutes les URLs YouTube que vous postez seront automatiquement téléchargées.' : '❌ Les URLs YouTube ne seront plus téléchargées automatiquement.'}

💡 Tapez \`/ytdl ${isEnabled ? 'off' : 'on'}\` pour ${isEnabled ? 'désactiver' : 'activer'}.`;
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            log.info(`🔧 Auto-download YouTube ${isEnabled ? 'activé' : 'désactivé'} pour ${senderId}`);
            return statusMsg;
        }

        // VALIDATION DE L'URL YOUTUBE
        const url = args.trim();
        
        if (!isValidYouTubeUrl(url)) {
            const invalidMsg = `❌ **URL YouTube invalide !**

📝 **Formats acceptés :**
• \`https://www.youtube.com/watch?v=VIDEO_ID\`
• \`https://youtu.be/VIDEO_ID\`
• \`https://www.youtube.com/shorts/VIDEO_ID\`
• \`https://music.youtube.com/watch?v=VIDEO_ID\`

**Exemples valides :**
• \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
• \`https://youtu.be/dQw4w9WgXcQ\`
• \`https://www.youtube.com/shorts/abc123\`

💡 **Astuce :** Copiez l'URL directement depuis YouTube !`;

            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', invalidMsg);
            return invalidMsg;
        }

        // VÉRIFICATION DES DOUBLONS
        const cacheKey = `${senderIdStr}_${url}`;
        const now = Date.now();
        
        // Nettoyer le cache des entrées expirées
        cleanExpiredCache();
        
        if (downloadCache.has(cacheKey)) {
            const cacheEntry = downloadCache.get(cacheKey);
            const timeElapsed = now - cacheEntry.timestamp;
            const remainingTime = Math.ceil((CACHE_DURATION - timeElapsed) / 1000);
            
            if (timeElapsed < CACHE_DURATION) {
                const duplicateMsg = `🔄 **Téléchargement récent détecté !**

⚠️ Vous avez déjà téléchargé cette vidéo il y a ${Math.floor(timeElapsed / 1000)} secondes.

🎬 **Vidéo :** ${cacheEntry.title || 'Titre non disponible'}
📺 **Chaîne :** ${cacheEntry.author || 'Auteur inconnu'}
🔗 **URL :** ${shortenUrl(url)}

⏱️ Vous pourrez la télécharger à nouveau dans **${remainingTime} secondes**.

💡 Ceci évite les téléchargements en double et préserve la bande passante.`;

                log.info(`🔄 Doublon YouTube évité pour ${senderId}: ${url.substring(0, 50)}...`);
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', duplicateMsg);
                return duplicateMsg;
            }
        }

        // TÉLÉCHARGEMENT YOUTUBE
        log.info(`📥 Début téléchargement YouTube pour ${senderId}: ${url.substring(0, 50)}...`);
        
        const downloadingMsg = `⏳ **Téléchargement YouTube en cours...**

🔗 URL: ${shortenUrl(url)}
🔴 Extraction des informations vidéo...

💡 Cela peut prendre quelques secondes selon la taille de la vidéo...`;

        // Envoyer le message de chargement d'abord
        addToMemory(senderIdStr, 'user', args);
        await sendMessage(senderId, downloadingMsg);

        try {
            // VALIDATION DE L'URL AVEC YTDL
            if (!ytdl.validateURL(url)) {
                throw new Error('URL YouTube invalide selon ytdl-core');
            }

            // EXTRACTION DES INFORMATIONS VIDÉO
            log.debug(`📡 Extraction infos YouTube: ${url}`);
            const info = await ytdl.getInfo(url);
            
            if (!info || !info.videoDetails) {
                throw new Error('Impossible d\'obtenir les informations de la vidéo');
            }

            const videoDetails = info.videoDetails;
            const title = videoDetails.title;
            const author = videoDetails.author?.name || videoDetails.ownerChannelName;
            const duration = formatDuration(videoDetails.lengthSeconds);
            const thumbnail = videoDetails.thumbnails?.[0]?.url;
            const viewCount = videoDetails.viewCount;

            log.info(`✅ Infos extraites: ${title} par ${author}`);

            // SÉLECTION DU MEILLEUR FORMAT
            const format = selectBestFormat(info.formats);
            
            if (!format || !format.url) {
                throw new Error('Aucun format de téléchargement disponible');
            }

            log.info(`🎬 Format sélectionné: ${format.qualityLabel || format.quality} (${format.container})`);

            // AJOUTER AU CACHE AVANT L'ENVOI
            downloadCache.set(cacheKey, {
                timestamp: now,
                title: title,
                author: author,
                videoId: videoDetails.videoId,
                duration: duration
            });

            // PRÉPARATION DU MESSAGE DE RÉSULTAT
            let resultMessage = `✅ **Téléchargement YouTube terminé !**\n\n`;
            resultMessage += `🎬 **Titre :** ${cleanText(title, 80)}\n`;
            resultMessage += `📺 **Chaîne :** ${cleanText(author, 50)}\n`;
            
            if (duration) {
                resultMessage += `⏱️ **Durée :** ${duration}\n`;
            }
            
            if (viewCount) {
                resultMessage += `👀 **Vues :** ${formatNumber(viewCount)}\n`;
            }
            
            resultMessage += `🔴 **Plateforme :** YouTube\n`;
            resultMessage += `📱 **Demandé par :** User ${senderId}\n`;
            resultMessage += `🎯 **Qualité :** ${format.qualityLabel || format.quality}\n\n`;
            resultMessage += `💕 **Téléchargé avec amour par NakamaBot !**`;

            // TÉLÉCHARGEMENT ET ENVOI DU MÉDIA
            log.info(`📤 Tentative d'envoi du média YouTube...`);
            
            try {
                // Essayer d'envoyer comme vidéo
                const videoResult = await sendVideoMessage(senderId, format.url, resultMessage);
                
                if (videoResult.success) {
                    addToMemory(senderIdStr, 'assistant', resultMessage);
                    log.info(`✅ Vidéo YouTube téléchargée avec succès pour ${senderId}`);
                    return { type: 'media_sent', success: true };
                } else {
                    log.warning(`⚠️ Échec envoi vidéo YouTube, tentative lien direct...`);
                    throw new Error('Envoi vidéo échoué');
                }
            } catch (sendError) {
                log.error(`❌ Erreur envoi média YouTube: ${sendError.message}`);
                
                // FALLBACK: Envoyer le lien direct
                const fallbackMsg = `📎 **Lien de téléchargement YouTube direct :**

🔗 ${format.url}

🎬 **Titre :** ${cleanText(title, 60)}
📺 **Chaîne :** ${cleanText(author, 40)}
${duration ? `⏱️ **Durée :** ${duration}\n` : ''}🎯 **Qualité :** ${format.qualityLabel || format.quality}

📱 Cliquez sur le lien pour télécharger la vidéo directement !

💡 **Astuce :** Le téléchargement commencera automatiquement.

💕 **Préparé avec amour par NakamaBot !**`;

                addToMemory(senderIdStr, 'assistant', fallbackMsg);
                return fallbackMsg;
            }

        } catch (ytdlError) {
            log.error(`❌ Erreur YTDL: ${ytdlError.message}`);
            
            // Supprimer du cache en cas d'erreur
            downloadCache.delete(cacheKey);
            
            // MESSAGES D'ERREUR SPÉCIFIQUES YOUTUBE
            let errorMsg = "❌ **Échec du téléchargement YouTube**\n\n";
            
            if (ytdlError.message.includes('Video unavailable')) {
                errorMsg += "🚫 **Erreur :** Vidéo non disponible\n";
                errorMsg += "💡 **Causes possibles :**\n";
                errorMsg += "   • La vidéo est privée ou supprimée\n";
                errorMsg += "   • Restriction géographique\n";
                errorMsg += "   • Vidéo en cours de traitement par YouTube\n";
                errorMsg += "   • Problème de droits d'auteur";
            } else if (ytdlError.message.includes('Sign in to confirm your age')) {
                errorMsg += "🔞 **Erreur :** Vérification d'âge requise\n";
                errorMsg += "💡 **Solution :**\n";
                errorMsg += "   • Cette vidéo nécessite une connexion YouTube\n";
                errorMsg += "   • Essayez avec une autre vidéo publique";
            } else if (ytdlError.message.includes('This live event has ended')) {
                errorMsg += "📺 **Erreur :** Live terminé\n";
                errorMsg += "💡 **Info :**\n";
                errorMsg += "   • Ce live stream est terminé\n";
                errorMsg += "   • Il pourrait être disponible en replay plus tard";
            } else if (ytdlError.message.includes('rate limit') || ytdlError.message.includes('429')) {
                errorMsg += "🚦 **Erreur :** Limite de taux atteinte\n";
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • Trop de requêtes récentes\n";
                errorMsg += "   • Attendez 5-10 minutes avant de réessayer\n";
                errorMsg += "   • Utilisez `/alldl` comme alternative";
            } else if (ytdlError.message.includes('timeout')) {
                errorMsg += "⏰ **Erreur :** Délai d'attente dépassé\n";
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • La vidéo est très longue ou lourde\n";
                errorMsg += "   • Les serveurs YouTube sont lents\n";
                errorMsg += "   • Réessayez dans quelques minutes";
            } else if (ytdlError.message.includes('No such file or directory')) {
                errorMsg += "🔧 **Erreur :** Problème technique\n";
                errorMsg += "💡 **Info :**\n";
                errorMsg += "   • Problème temporaire du système\n";
                errorMsg += "   • Contactez l'administrateur si cela persiste";
            } else {
                errorMsg += `🐛 **Erreur technique :** ${ytdlError.message.substring(0, 100)}\n`;
                errorMsg += "💡 **Solutions générales :**\n";
                errorMsg += "   • Vérifiez que l'URL YouTube est correcte\n";
                errorMsg += "   • Réessayez dans quelques minutes\n";
                errorMsg += "   • Utilisez `/alldl` comme alternative\n";
                errorMsg += "   • Contactez l'admin si le problème persiste";
            }
            
            errorMsg += `\n🔗 **URL testée :** ${shortenUrl(url)}`;
            errorMsg += "\n🔴 **Source :** YouTube Direct";
            errorMsg += "\n\n🆘 Tapez `/help` pour plus d'aide !";

            addToMemory(senderIdStr, 'assistant', errorMsg);
            return errorMsg;
        }

    } catch (error) {
        log.error(`❌ Erreur générale ytdl pour ${senderId}: ${error.message}`);
        
        const generalErrorMsg = `💥 **Oups ! Erreur YouTube inattendue**

🐛 Une petite erreur technique s'est produite...

**Solutions possibles :**
• Vérifiez que votre URL YouTube est complète et correcte
• Assurez-vous que la vidéo est publique et disponible
• Réessayez dans quelques instants  
• Utilisez \`/alldl\` comme méthode alternative
• Contactez l'admin si le problème persiste

🔗 **URL :** ${args ? shortenUrl(args) : 'Non fournie'}
🔴 **Méthode :** YouTube Direct (ytdl-core)

💕 Désolée pour ce petit désagrément ! Essayons une autre approche !`;

        addToMemory(senderIdStr, 'assistant', generalErrorMsg);
        return generalErrorMsg;
    }
};

// === FONCTIONS UTILITAIRES YOUTUBE ===

/**
 * Valide si une URL est une URL YouTube valide
 * @param {string} url - URL à valider
 * @returns {boolean} - True si URL YouTube valide
 */
function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    const youtubeRegex = /^https?:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/|music\.youtube\.com\/watch\?v=)[\w-]{11}(\S+)?$/;
    return youtubeRegex.test(url);
}

/**
 * Sélectionne le meilleur format de téléchargement
 * @param {Array} formats - Liste des formats disponibles
 * @returns {object} - Meilleur format sélectionné
 */
function selectBestFormat(formats) {
    if (!formats || formats.length === 0) return null;
    
    // Filtrer les formats avec audio et vidéo
    const videoFormats = formats.filter(f => 
        f.hasVideo && 
        f.hasAudio && 
        f.url &&
        !f.isLive &&
        f.container !== 'webm' // Préférer MP4
    );
    
    if (videoFormats.length > 0) {
        // Préférer 720p, puis 480p, puis 360p
        const preferred = videoFormats.find(f => f.qualityLabel === '720p') ||
                         videoFormats.find(f => f.qualityLabel === '480p') ||
                         videoFormats.find(f => f.qualityLabel === '360p') ||
                         videoFormats[0];
        return preferred;
    }
    
    // Si pas de format vidéo+audio, prendre audio seul
    const audioFormats = formats.filter(f => 
        f.hasAudio && 
        !f.hasVideo && 
        f.url
    );
    
    if (audioFormats.length > 0) {
        return audioFormats.find(f => f.audioBitrate) || audioFormats[0];
    }
    
    // En dernier recours, prendre le premier format disponible
    return formats.find(f => f.url) || null;
}

/**
 * Formate la durée en secondes en format lisible
 * @param {string|number} seconds - Durée en secondes
 * @returns {string} - Durée formatée
 */
function formatDuration(seconds) {
    if (!seconds) return null;
    
    const sec = parseInt(seconds);
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const remainingSeconds = sec % 60;
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}

/**
 * Formate un nombre pour l'affichage
 * @param {string|number} num - Nombre à formater
 * @returns {string} - Nombre formaté
 */
function formatNumber(num) {
    if (!num) return '0';
    
    const number = parseInt(num);
    if (number >= 1000000) {
        return (number / 1000000).toFixed(1) + 'M';
    } else if (number >= 1000) {
        return (number / 1000).toFixed(1) + 'K';
    }
    return number.toString();
}

/**
 * Raccourcit une URL pour l'affichage
 * @param {string} url - URL complète
 * @returns {string} - URL raccourcie
 */
function shortenUrl(url) {
    if (!url) return 'URL manquante';
    return url.length > 60 ? url.substring(0, 60) + '...' : url;
}

/**
 * Nettoie le texte des caractères spéciaux problématiques
 * @param {string} text - Texte à nettoyer
 * @param {number} maxLength - Longueur maximale
 * @returns {string} - Texte nettoyé
 */
function cleanText(text, maxLength = 100) {
    if (!text) return 'Non disponible';
    
    return text
        .replace(/[^\w\s\-\.,!?()\[\]]/g, '') // Enlever les caractères spéciaux
        .substring(0, maxLength)
        .trim();
}

/**
 * Nettoie le cache des entrées expirées
 */
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
        console.log(`🧹 Cache YouTube nettoyé: ${expiredKeys.length} entrées expirées supprimées`);
    }
}

/**
 * Obtient les statistiques du cache
 */
function getCacheStats() {
    const now = Date.now();
    let activeEntries = 0;
    let expiredEntries = 0;
    
    for (const [key, entry] of downloadCache.entries()) {
        if (now - entry.timestamp <= CACHE_DURATION) {
            activeEntries++;
        } else {
            expiredEntries++;
        }
    }
    
    return {
        total: downloadCache.size,
        active: activeEntries,
        expired: expiredEntries
    };
}

/**
 * Fonction pour envoyer une vidéo (à adapter selon votre système)
 * @param {string} recipientId - ID du destinataire
 * @param {string} videoUrl - URL de la vidéo
 * @param {string} caption - Légende
 * @returns {object} - Résultat de l'envoi
 */
async function sendVideoMessage(recipientId, videoUrl, caption = "") {
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
                    is_reusable: false // YouTube URLs changent souvent
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
                timeout: 45000 // 45 secondes pour YouTube
            }
        );
        
        if (response.status === 200) {
            // Envoyer la légende séparément si fournie
            if (caption && typeof sendMessage === 'function') {
                await new Promise(resolve => setTimeout(resolve, 1500)); // Attendre 1.5s
                return await sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// === AUTO-DOWNLOAD HANDLER YOUTUBE ===

/**
 * Fonction pour gérer l'auto-téléchargement YouTube
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} messageText - Texte du message
 * @param {object} ctx - Contexte
 */
async function handleYouTubeAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    // Vérifier si l'auto-download YouTube est activé pour cet utilisateur
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    // Chercher des URLs YouTube dans le message
    const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|music\.youtube\.com\/watch\?v=)[\w-]{11}(?:\S+)?)/gi;
    const urls = messageText.match(youtubeRegex);
    
    if (urls && urls.length > 0) {
        const url = urls[0]; // Prendre la première URL YouTube trouvée
        
        try {
            ctx.log.info(`🔴 Auto-téléchargement YouTube déclenché pour ${senderId}: ${url.substring(0, 50)}...`);
            
            // Exécuter la commande ytdl automatiquement
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            ctx.log.warning(`⚠️ Erreur auto-download YouTube pour ${senderId}: ${error.message}`);
        }
    }
    
    return false;
}

// Export des fonctions utilitaires
module.exports.handleYouTubeAutoDownload = handleYouTubeAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidYouTubeUrl = isValidYouTubeUrl;
module.exports.downloadCache = downloadCache;
module.exports.getCacheStats = getCacheStats;
module.exports.cleanExpiredCache = cleanExpiredCache;
module.exports.selectBestFormat = selectBestFormat;
