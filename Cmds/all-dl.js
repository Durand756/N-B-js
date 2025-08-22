/**
 * Commande ALLDL - Téléchargement universel de médias
 * Supporte YouTube, TikTok, Facebook, Instagram, Twitter, etc.
 * Avec système d'auto-téléchargement pour les groupes (admin seulement)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - URL ou paramètres (on/off pour auto-download)
 * @param {object} ctx - Contexte du bot
 */

const axios = require('axios');

// Configuration de l'API
const ALLDL_API_URL = 'https://noobs-api.top/dipto/alldl';

// Stockage local des paramètres d'auto-téléchargement par utilisateur/groupe
const autoDownloadSettings = new Map();

module.exports = async function cmdAllDl(senderId, args, ctx) {
    const { log, sendMessage, sendImageMessage, addToMemory, isAdmin } = ctx;
    const senderIdStr = String(senderId);
    
    try {
        if (!args || !args.trim()) {
            const helpMsg = `📥 **Téléchargeur Universel ALLDL**

🔗 **Usage :** \`/alldl [URL]\`

**Plateformes supportées :**
• YouTube (vidéos/shorts)
• TikTok
• Facebook
• Instagram (posts/reels/stories)
• Twitter/X
• Et bien d'autres !

**Commandes admin :**
• \`/alldl on\` - Active l'auto-téléchargement
• \`/alldl off\` - Désactive l'auto-téléchargement

💡 **Exemple :** \`/alldl https://www.youtube.com/watch?v=...\`

⚠️ L'auto-téléchargement permet de télécharger automatiquement toute URL postée (réservé aux admins).`;

            addToMemory(senderIdStr, 'user', args || '/alldl');
            addToMemory(senderIdStr, 'assistant', helpMsg);
            return helpMsg;
        }

        const command = args.trim().toLowerCase();

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
            
            const statusMsg = `🔧 Auto-téléchargement ${isEnabled ? '**activé**' : '**désactivé**'} pour vous !

${isEnabled ? '✅ Toutes les URLs que vous postez seront automatiquement téléchargées.' : '❌ Les URLs ne seront plus téléchargées automatiquement.'}

💡 Tapez \`/alldl ${isEnabled ? 'off' : 'on'}\` pour ${isEnabled ? 'désactiver' : 'activer'}.`;
            
            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', statusMsg);
            log.info(`🔧 Auto-download ${isEnabled ? 'activé' : 'désactivé'} pour ${senderId}`);
            return statusMsg;
        }

        // 🔍 VALIDATION DE L'URL
        const url = args.trim();
        
        if (!isValidUrl(url)) {
            const invalidMsg = `❌ URL invalide ! 

📝 **Format attendu :** \`https://...\`

**Exemples valides :**
• \`https://www.youtube.com/watch?v=dQw4w9WgXcQ\`
• \`https://www.tiktok.com/@user/video/123456\`
• \`https://www.instagram.com/p/ABC123/\`

💡 Astuce : Copiez-collez directement l'URL depuis votre navigateur !`;

            addToMemory(senderIdStr, 'user', args);
            addToMemory(senderIdStr, 'assistant', invalidMsg);
            return invalidMsg;
        }

        // 🚀 TÉLÉCHARGEMENT
        log.info(`📥 Début téléchargement pour ${senderId}: ${url.substring(0, 50)}...`);
        
        const downloadingMsg = `⏳ **Téléchargement en cours...**

🔗 URL: ${url.length > 80 ? url.substring(0, 80) + '...' : url}

💡 Cela peut prendre quelques secondes selon la taille du média...`;

        // Envoyer le message de chargement d'abord
        addToMemory(senderIdStr, 'user', args);
        await sendMessage(senderId, downloadingMsg);

        try {
            // 📡 APPEL À L'API ALLDL
            const apiUrl = `${ALLDL_API_URL}?url=${encodeURIComponent(url)}`;
            log.debug(`📡 Appel API ALLDL: ${apiUrl}`);

            const response = await axios.get(apiUrl, { 
                timeout: 60000, // 60 secondes pour les gros fichiers
                maxRedirects: 5
            });

            if (!response.data || !response.data.result) {
                throw new Error('Réponse API invalide ou média non disponible');
            }

            const mediaData = response.data;
            const { title, result: mediaUrl, duration, thumbnail } = mediaData;

            // 🎬 PRÉPARATION DU MESSAGE DE RÉSULTAT
            let resultMessage = `✅ **Téléchargement terminé !**\n\n`;
            
            if (title) {
                resultMessage += `📽️ **Titre :** ${title}\n`;
            }
            
            if (duration) {
                resultMessage += `⏱️ **Durée :** ${duration}\n`;
            }
            
            resultMessage += `🔗 **Source :** ${extractDomain(url)}\n`;
            resultMessage += `👤 **Demandé par :** User ${senderId}\n\n`;
            resultMessage += `💕 **Téléchargé avec amour par NakamaBot !**`;

            // 🚀 ENVOI DU MÉDIA
            if (mediaUrl) {
                // Déterminer le type de média basé sur l'URL
                const mediaType = getMediaType(mediaUrl);
                
                if (mediaType === 'video') {
                    // Envoyer comme vidéo
                    const videoResult = await sendImageMessage(senderId, mediaUrl, resultMessage);
                    
                    if (videoResult.success) {
                        addToMemory(senderIdStr, 'assistant', resultMessage);
                        log.info(`✅ Vidéo téléchargée avec succès pour ${senderId}`);
                        return { type: 'media_sent', success: true };
                    } else {
                        throw new Error('Échec envoi vidéo');
                    }
                } else {
                    // Envoyer comme image
                    const imageResult = await sendImageMessage(senderId, mediaUrl, resultMessage);
                    
                    if (imageResult.success) {
                        addToMemory(senderIdStr, 'assistant', resultMessage);
                        log.info(`✅ Image téléchargée avec succès pour ${senderId}`);
                        return { type: 'media_sent', success: true };
                    } else {
                        throw new Error('Échec envoi image');
                    }
                }
            } else {
                throw new Error('URL du média introuvable dans la réponse');
            }

        } catch (apiError) {
            log.error(`❌ Erreur API ALLDL: ${apiError.message}`);
            
            // Messages d'erreur spécifiques
            let errorMsg = "❌ **Échec du téléchargement**\n\n";
            
            if (apiError.response?.status === 404) {
                errorMsg += "🚫 **Erreur :** Média introuvable ou URL invalide\n";
                errorMsg += "💡 **Solution :** Vérifiez que l'URL est correcte et accessible";
            } else if (apiError.response?.status === 403) {
                errorMsg += "🔒 **Erreur :** Accès refusé (contenu privé)\n";
                errorMsg += "💡 **Solution :** Le contenu est peut-être privé ou géo-restreint";
            } else if (apiError.code === 'ECONNABORTED' || apiError.message.includes('timeout')) {
                errorMsg += "⏰ **Erreur :** Délai d'attente dépassé\n";
                errorMsg += "💡 **Solution :** Le fichier est trop volumineux ou le serveur est lent, réessayez";
            } else if (apiError.response?.status >= 500) {
                errorMsg += "🔧 **Erreur :** Problème serveur temporaire\n";
                errorMsg += "💡 **Solution :** Réessayez dans quelques minutes";
            } else {
                errorMsg += `🐛 **Erreur :** ${apiError.message}\n`;
                errorMsg += "💡 **Solution :** Vérifiez l'URL ou contactez l'admin si le problème persiste";
            }
            
            errorMsg += `\n🔗 **URL testée :** ${url.length > 60 ? url.substring(0, 60) + '...' : url}`;
            errorMsg += "\n\n🆘 Tapez `/help` si vous avez besoin d'aide !";

            addToMemory(senderIdStr, 'assistant', errorMsg);
            return errorMsg;
        }

    } catch (error) {
        log.error(`❌ Erreur générale alldl pour ${senderId}: ${error.message}`);
        
        const generalErrorMsg = `💥 **Oups ! Erreur inattendue**

🐛 Une petite erreur technique s'est produite...

**Solutions possibles :**
• Vérifiez votre URL
• Réessayez dans quelques instants  
• Contactez l'admin si ça persiste

💕 Désolée pour ce petit désagrément ! Je fais de mon mieux !`;

        addToMemory(senderIdStr, 'assistant', generalErrorMsg);
        return generalErrorMsg;
    }
};

// === FONCTIONS UTILITAIRES ===

/**
 * Valide si une chaîne est une URL valide
 * @param {string} string - Chaîne à valider
 * @returns {boolean} - True si URL valide
 */
function isValidUrl(string) {
    if (!string || typeof string !== 'string') return false;
    
    try {
        const url = new URL(string);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
        return false;
    }
}

/**
 * Extrait le domaine d'une URL
 * @param {string} url - URL complète
 * @returns {string} - Nom du domaine
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        let domain = urlObj.hostname;
        
        // Simplifier les domaines connus
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
        } else {
            return domain.replace('www.', '');
        }
    } catch (error) {
        return 'Site inconnu';
    }
}

/**
 * Détermine le type de média basé sur l'URL
 * @param {string} url - URL du média
 * @returns {string} - 'video' ou 'image'
 */
function getMediaType(url) {
    if (!url) return 'unknown';
    
    const lowerUrl = url.toLowerCase();
    
    // Extensions vidéo
    const videoExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v', '.3gp', '.flv'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    
    // Vérifier les extensions
    for (const ext of videoExtensions) {
        if (lowerUrl.includes(ext)) return 'video';
    }
    
    for (const ext of imageExtensions) {
        if (lowerUrl.includes(ext)) return 'image';
    }
    
    // Par défaut, considérer comme vidéo pour les médias sociaux
    return 'video';
}

// === AUTO-DOWNLOAD HANDLER (Pour intégration future dans le système de messages) ===

/**
 * Fonction pour gérer l'auto-téléchargement (à intégrer dans le webhook principal)
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} messageText - Texte du message
 * @param {object} ctx - Contexte
 */
async function handleAutoDownload(senderId, messageText, ctx) {
    const senderIdStr = String(senderId);
    
    // Vérifier si l'auto-download est activé pour cet utilisateur
    if (!autoDownloadSettings.get(senderIdStr)) return false;
    
    // Chercher des URLs dans le message
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const urls = messageText.match(urlRegex);
    
    if (urls && urls.length > 0) {
        const url = urls[0]; // Prendre la première URL trouvée
        
        try {
            // Exécuter la commande alldl automatiquement
            await module.exports(senderId, url, ctx);
            return true;
        } catch (error) {
            ctx.log.warning(`⚠️ Erreur auto-download pour ${senderId}: ${error.message}`);
        }
    }
    
    return false;
}

// Export des fonctions utilitaires
module.exports.handleAutoDownload = handleAutoDownload;
module.exports.autoDownloadSettings = autoDownloadSettings;
module.exports.isValidUrl = isValidUrl;
