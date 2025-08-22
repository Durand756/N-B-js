/**
 * Commande ALLDL + MUSIC FUSIONNÉE - Recherche et téléchargement automatique
 * Supporte YouTube, TikTok, Facebook, Instagram, Twitter, etc.
 * ✅ NOUVEAU: Intégration recherche YouTube + téléchargement automatique
 * ✅ Système anti-doublons et auto-téléchargement pour admins
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - URL, titre de musique, ou paramètres (on/off)
 * @param {object} ctx - Contexte du bot
 */

const axios = require('axios');
const Youtube = require('youtube-search-api');

// Configuration des APIs
const ALLDL_API_URL = 'https://noobs-api.top/dipto/alldl';

// Stockage local des paramètres
const autoDownloadSettings = new Map();
const downloadCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

module.exports = async function cmdAllDlMusic(senderId, args, ctx) {
    const { log, sendMessage, sendImageMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        if (!args || !args.trim()) {
            const helpMsg = `🎵📥 **Téléchargeur Universel + Recherche Musique**

**🔍 RECHERCHE + TÉLÉCHARGEMENT :**
• \`/alldl [titre musique]\` - Recherche et télécharge depuis YouTube
• \`/alldl [URL]\` - Télécharge directement depuis l'URL

**🔗 PLATEFORMES SUPPORTÉES :**
• YouTube (vidéos/shorts/musiques)
• TikTok, Facebook, Instagram
• Twitter/X et bien d'autres !

**🎶 EXEMPLES RECHERCHE :**
• \`/alldl blinding lights\`
• \`/alldl eminem lose yourself\`
• \`/alldl imagine dragons\`

**🔗 EXEMPLES URL :**
• \`/alldl https://youtube.com/watch?v=...\`
• \`/alldl https://tiktok.com/@user/video/...\`

**⚙️ COMMANDES ADMIN :**
• \`/alldl on\` - Active l'auto-téléchargement
• \`/alldl off\` - Désactive l'auto-téléchargement

💡 **Astuce :** Je peux chercher une musique même avec des fautes d'orthographe !`;

            addToMemory(senderIdStr, 'user', args || '/alldl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const input = args.trim();
        const command = input.toLowerCase();

        // 🔧 GESTION DES PARAMÈTRES AUTO-DOWNLOAD (Admin seulement)
        if (command === 'on' || command === 'off') {
            if (!isAdmin(senderId)) {
                const noPermMsg = "🚫 Seuls les administrateurs peuvent modifier l'auto-téléchargement !";
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', noPermMsg);
                return noPermMsg;
            }

            const isEnabled = command === 'on';
            autoDownloadSettings.set(senderIdStr, isEnabled);
            
            const statusMsg = `🔧 Auto-téléchargement ${isEnabled ? '**activé**' : '**désactivé**'} !

${isEnabled ? '✅ Toutes les URLs postées seront automatiquement téléchargées.' : '❌ Les URLs ne seront plus téléchargées automatiquement.'}

💡 Tapez \`/alldl ${isEnabled ? 'off' : 'on'}\` pour ${isEnabled ? 'désactiver' : 'activer'}.`;
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            log.info(`🔧 Auto-download ${isEnabled ? 'activé' : 'désactivé'} pour ${senderId}`);
            return statusMsg;
        }

        // 🎯 DÉTERMINER LE TYPE D'ENTRÉE : URL ou RECHERCHE
        let finalUrl = null;
        let searchQuery = null;
        let isDirectUrl = isValidUrl(input);

        if (isDirectUrl) {
            // ✅ URL DIRECTE
            finalUrl = input;
            log.info(`🔗 URL directe détectée: ${input.substring(0, 50)}...`);
        } else {
            // ✅ RECHERCHE YOUTUBE
            searchQuery = input;
            log.info(`🔍 Recherche YouTube: "${searchQuery}"`);
            
            const searchingMsg = `🔍 **Recherche en cours...**

🎵 Recherche: "${searchQuery}"
🔴 Plateforme: YouTube
⏳ Je cherche la meilleure correspondance...`;

            await sendMessage(senderId, searchingMsg);

            try {
                // 📡 RECHERCHE YOUTUBE
                const results = await Youtube.GetListByKeyword(searchQuery, false, 1);
                
                if (!results.items || results.items.length === 0) {
                    const noResultMsg = `😢 **Aucun résultat trouvé**

🔍 **Recherche :** "${searchQuery}"

💡 **Suggestions :**
• Vérifiez l'orthographe
• Essayez des mots-clés plus simples
• Ajoutez le nom de l'artiste
• Exemple: "eminem lose yourself" au lieu de "lose yourself"

🎵 Réessayez avec un autre titre !`;

                    addToMemory(senderIdStr, 'user', args);
                    addToMemory(senderIdStr, 'assistant', noResultMsg);
                    return noResultMsg;
                }

                const video = results.items[0];
                finalUrl = `https://www.youtube.com/watch?v=${video.id}`;
                
                const foundMsg = `✅ **Vidéo trouvée !**

🎵 **Titre :** ${video.title || 'Titre non disponible'}
👤 **Chaîne :** ${video.channelTitle || 'Chaîne inconnue'}
⏱️ **Durée :** ${video.length?.simpleText || 'Durée inconnue'}
🔗 **URL :** ${finalUrl}

⏳ **Téléchargement en cours...**`;
                
                await sendMessage(senderId, foundMsg);
                log.info(`✅ Vidéo trouvée: ${video.title} - ${finalUrl}`);
                
            } catch (searchError) {
                log.error(`❌ Erreur recherche YouTube: ${searchError.message}`);
                
                const searchErrorMsg = `🔍 **Erreur de recherche**

❌ Impossible de rechercher "${searchQuery}" sur YouTube.

**Causes possibles :**
• Problème de connexion temporaire
• Limitation de l'API YouTube
• Surcharge du serveur

🔄 **Solutions :**
• Réessayez dans quelques minutes
• Utilisez une URL YouTube directe
• Contactez l'admin si le problème persiste

💡 Vous pouvez aussi copier-coller directement un lien YouTube !`;

                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', searchErrorMsg);
                return searchErrorMsg;
            }
        }

        // ✅ À ce point, on a forcément une URL (directe ou trouvée)
        if (!finalUrl) {
            throw new Error('Aucune URL disponible pour le téléchargement');
        }

        // ✅ VÉRIFICATION DES DOUBLONS
        const cacheKey = `${senderIdStr}_${finalUrl}`;
        const now = Date.now();
        
        cleanExpiredCache();
        
        if (downloadCache.has(cacheKey)) {
            const cacheEntry = downloadCache.get(cacheKey);
            const timeElapsed = now - cacheEntry.timestamp;
            const remainingTime = Math.ceil((CACHE_DURATION - timeElapsed) / 1000);
            
            if (timeElapsed < CACHE_DURATION) {
                const duplicateMsg = `🔄 **Téléchargement récent détecté !**

⚠️ Vous avez déjà téléchargé ce contenu il y a ${Math.floor(timeElapsed / 1000)} secondes.

${searchQuery ? `🔍 **Recherche :** ${searchQuery}` : ''}
🎬 **Titre :** ${cacheEntry.title || 'Titre non disponible'}
🔗 **URL :** ${finalUrl.length > 60 ? finalUrl.substring(0, 60) + '...' : finalUrl}

⏱️ Vous pourrez le télécharger à nouveau dans **${remainingTime} secondes**.

💡 Ceci évite les téléchargements en double et préserve les ressources.`;

                log.info(`🔄 Doublon évité pour ${senderId}: ${finalUrl.substring(0, 50)}...`);
                addToMemory(senderIdStr, 'user', args);
                addToMemory(senderIdStr, 'assistant', duplicateMsg);
                return duplicateMsg;
            }
        }

        // 🚀 TÉLÉCHARGEMENT PRINCIPAL
        log.info(`📥 Début téléchargement pour ${senderId}: ${finalUrl.substring(0, 50)}...`);
        
        const downloadingMsg = `⏳ **Téléchargement en cours...**

${searchQuery ? `🔍 **Recherche :** "${searchQuery}"\n` : ''}🔗 **URL :** ${finalUrl.length > 80 ? finalUrl.substring(0, 80) + '...' : finalUrl}
🎬 **Plateforme :** ${extractDomain(finalUrl)}

💡 Cela peut prendre quelques secondes selon la taille du fichier...`;

        // Message de téléchargement seulement si pas déjà envoyé pour la recherche
        if (isDirectUrl) {
            await sendMessage(senderId, downloadingMsg);
        }

        try {
            // 📡 APPEL À L'API ALLDL
            const apiUrl = `${ALLDL_API_URL}?url=${encodeURIComponent(finalUrl)}`;
            log.debug(`📡 Appel API ALLDL: ${apiUrl}`);

            const response = await axios.get(apiUrl, { 
                timeout: 60000,
                maxRedirects: 5,
                validateStatus: function (status) {
                    return status >= 200 && status < 500;
                }
            });

            log.debug(`📊 Réponse API: Status ${response.status}`);

            if (!response.data || response.status !== 200) {
                throw new Error(`API a retourné le statut ${response.status}`);
            }

            const mediaData = response.data;
            
            // ✅ EXTRACTION DES DONNÉES MÉDIA
            let mediaUrl = null;
            let title = null;
            let author = null;
            let thumbnail = null;
            let duration = null;

            if (mediaData.result) {
                mediaUrl = mediaData.result;
                title = mediaData.Title || mediaData.title || null;
                author = mediaData.author || null;
                thumbnail = mediaData.thumbnail || null;
                duration = mediaData.duration || null;
            } else if (mediaData.url) {
                mediaUrl = mediaData.url;
                title = mediaData.title || mediaData.Title || null;
                author = mediaData.author || null;
            } else if (mediaData.medias && mediaData.medias.length > 0) {
                mediaUrl = mediaData.medias[0].url;
                title = mediaData.title || null;
            } else if (mediaData.error || mediaData.message) {
                throw new Error(mediaData.error || mediaData.message || 'Erreur API non spécifiée');
            }

            if (!mediaUrl || !isValidUrl(mediaUrl)) {
                throw new Error('URL du média introuvable ou invalide dans la réponse de l\'API');
            }

            log.info(`✅ Média URL obtenue: ${mediaUrl.substring(0, 100)}...`);

            // ✅ AJOUTER AU CACHE
            downloadCache.set(cacheKey, {
                timestamp: now,
                title: title,
                mediaUrl: mediaUrl,
                author: author,
                searchQuery: searchQuery
            });

            // 🎬 PRÉPARATION DU MESSAGE DE RÉSULTAT
            let resultMessage = `✅ **Téléchargement terminé !**\n\n`;
            
            if (searchQuery) {
                resultMessage += `🔍 **Recherche :** "${searchQuery}"\n`;
            }
            
            if (title) {
                const cleanTitle = title.replace(/[^\w\s\-\.,!?()]/g, '').substring(0, 100);
                resultMessage += `🎵 **Titre :** ${cleanTitle}\n`;
            }
            
            if (author) {
                const cleanAuthor = author.replace(/[^\w\s\-\.,!?()]/g, '').substring(0, 50);
                resultMessage += `👤 **Auteur :** ${cleanAuthor}\n`;
            }
            
            if (duration) {
                resultMessage += `⏱️ **Durée :** ${duration}\n`;
            }
            
            resultMessage += `🔗 **Source :** ${extractDomain(finalUrl)}\n`;
            resultMessage += `📱 **Demandé par :** User ${senderId}\n\n`;
            resultMessage += `💕 **Téléchargé avec amour par NakamaBot !**`;

            // 🚀 ENVOI DU MÉDIA
            log.info(`📤 Tentative d'envoi du média...`);
            
            try {
                const videoResult = await sendVideoMessage(senderId, mediaUrl, resultMessage, ctx);
                
                if (videoResult.success) {
                    addToMemory(senderIdStr, 'assistant', resultMessage);
                    log.info(`✅ Vidéo téléchargée avec succès pour ${senderId}`);
                    return { type: 'media_sent', success: true };
                } else {
                    log.warning(`⚠️ Échec envoi vidéo, tentative image...`);
                    
                    const imageResult = await sendImageMessage(senderId, mediaUrl, resultMessage);
                    
                    if (imageResult.success) {
                        addToMemory(senderIdStr, 'assistant', resultMessage);
                        log.info(`✅ Image téléchargée avec succès pour ${senderId}`);
                        return { type: 'media_sent', success: true };
                    } else {
                        throw new Error('Impossible d\'envoyer le média');
                    }
                }
            } catch (sendError) {
                log.error(`❌ Erreur envoi média: ${sendError.message}`);
                
                // ✅ FALLBACK: Lien direct
                const fallbackMsg = `📎 **Lien de téléchargement direct :**

🔗 ${mediaUrl}

${searchQuery ? `🔍 **Recherche :** "${searchQuery}"\n` : ''}${title ? `🎵 **Titre :** ${title}\n` : ''}${author ? `👤 **Auteur :** ${author}\n` : ''}
📱 Cliquez sur le lien pour télécharger directement !

💡 **Astuce :** Le téléchargement démarrera automatiquement.

💕 **Préparé avec amour par NakamaBot !**`;

                addToMemory(senderIdStr, 'assistant', fallbackMsg);
                return fallbackMsg;
            }

        } catch (apiError) {
            log.error(`❌ Erreur API ALLDL: ${apiError.message}`);
            
            downloadCache.delete(cacheKey);
            
            // ✅ MESSAGES D'ERREUR SPÉCIFIQUES
            let errorMsg = "❌ **Échec du téléchargement**\n\n";
            
            if (searchQuery) {
                errorMsg += `🔍 **Recherche :** "${searchQuery}"\n`;
            }
            
            if (apiError.response?.status === 404) {
                errorMsg += "🚫 **Erreur :** Contenu introuvable\n";
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • Vérifiez que le contenu existe toujours\n";
                errorMsg += "   • Assurez-vous qu'il est public\n";
                errorMsg += searchQuery ? "   • Essayez une recherche différente" : "   • Testez avec une autre URL";
            } else if (apiError.response?.status === 403) {
                errorMsg += "🔒 **Erreur :** Contenu privé ou géo-restreint\n";
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • Le contenu pourrait être privé\n";
                errorMsg += "   • Il pourrait être géo-restreint\n";
                errorMsg += searchQuery ? "   • Cherchez un autre titre" : "   • Essayez un autre lien";
            } else if (apiError.code === 'ECONNABORTED') {
                errorMsg += "⏰ **Erreur :** Délai d'attente dépassé\n";
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • Le fichier est trop volumineux\n";
                errorMsg += "   • Serveur temporairement lent\n";
                errorMsg += "   • Réessayez dans quelques minutes";
            } else {
                errorMsg += `🐛 **Erreur technique :** ${apiError.message}\n`;
                errorMsg += "💡 **Solutions :**\n";
                errorMsg += "   • Réessayez dans quelques minutes\n";
                errorMsg += "   • Vérifiez votre connexion\n";
                errorMsg += "   • Contactez l'admin si persistant";
            }
            
            errorMsg += `\n🔗 **URL :** ${finalUrl.length > 60 ? finalUrl.substring(0, 60) + '...' : finalUrl}`;
            errorMsg += `\n🎬 **Plateforme :** ${extractDomain(finalUrl)}`;
            errorMsg += "\n\n🆘 Tapez `/help` pour obtenir de l'aide !";

            addToMemory(senderIdStr, 'assistant', errorMsg);
            return errorMsg;
        }

    } catch (error) {
        log.error(`❌ Erreur générale pour ${senderId}: ${error.message}`);
        
        const generalErrorMsg = `💥 **Oups ! Erreur inattendue**

🐛 Une erreur technique s'est produite...

${args && !isValidUrl(args) ? `🔍 **Recherche :** "${args}"\n` : ''}

**Solutions :**
• Vérifiez votre saisie
• Réessayez dans quelques instants
• Contactez l'admin si le problème persiste

💕 Désolé pour ce petit désagrément !`;

        addToMemory(senderIdStr, 'assistant', generalErrorMsg);
        return generalErrorMsg;
    }
};

// === FONCTIONS UTILITAIRES ===

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
        console.log(`🧹 Cache nettoyé: ${expiredKeys.length} entrées expirées`);
    }
}

function isValidUrl(string) {
    if (!string || typeof string !== 'string') return false;
    
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname.toLowerCase();
        
        if (domain.includes('youtube.com') || domain.includes('youtu.be')) {
            return '🔴 YouTube';
        } else if (domain.includes('tiktok.com')) {
            return '🎵 TikTok';
        } else if (domain.includes('instagram.com')) {
            return '📸 Instagram';
        } else if (domain.includes('facebook.com') || domain.includes('fb.watch')) {
            return '📘 Facebook';
        } else if (domain.includes('twitter.com') || domain.includes('x.com')) {
            return '🐦 Twitter/X';
        } else if (domain.includes('snapchat.com')) {
            return '👻 Snapchat';
        } else if (domain.includes('pinterest.com')) {
            return '📌 Pinterest';
        } else if (domain.includes('linkedin.com')) {
            return '💼 LinkedIn';
        } else if (domain.includes('reddit.com')) {
            return '🤖 Reddit';
        } else if (domain.includes('twitch.tv')) {
            return '🎮 Twitch';
        } else {
            return '🌐 ' + domain.replace('www.', '');
        }
    } catch (error) {
        return '🌐 Site inconnu';
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
                    is_reusable: true
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
                timeout: 30000
            }
        );
        
        if (response.status === 200) {
            if (caption && ctx.sendMessage) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                return await ctx.sendMessage(recipientId, caption);
            }
            return { success: true };
        } else {
            return { success: false, error: `API Error ${response.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// === AUTO-DOWNLOAD HANDLER ===
async function handleAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    const urlRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|tiktok\.com\/@[\w.-]+\/video\/|instagram\.com\/(?:p|reel)\/|facebook\.com\/watch\/\?v=|fb\.watch\/|twitter\.com\/[\w]+\/status\/|x\.com\/[\w]+\/status\/)[\w.-]+(?:\S+)?)/gi;
    const urls = messageText.match(urlRegex);
    
    if (urls && urls.length > 0) {
        const url = urls[0];
        
        try {
            ctx.log.info(`🤖 Auto-téléchargement déclenché pour ${senderId}: ${url.substring(0, 50)}...`);
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            ctx.log.warning(`⚠️ Erreur auto-download: ${error.message}`);
        }
    }
    
    return false;
}

// Exports
module.exports.handleAutoDownload = handleAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidUrl = isValidUrl;
module.exports.downloadCache = downloadCache;
module.exports.cleanExpiredCache = cleanExpiredCache;
