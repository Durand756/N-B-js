// Cmds/ytb.js - Commande YouTube complète pour NakamaBot
// Adaptation complète avec téléchargement vidéo/audio

const axios = require("axios");
const ytdl = require("@distube/ytdl-core");
const fs = require("fs");
const path = require("path");

// Créer le dossier tmp s'il n'existe pas
const tmpDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
}

// Utilitaires
function formatNumber(num) {
    if (!num || isNaN(num)) return '0';
    if (num >= 1000000000) {
        return (num / 1000000000).toFixed(1) + 'B';
    }
    if (num >= 1000000) {
        return (num / 1000000).toFixed(1) + 'M';
    }
    if (num >= 1000) {
        return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
}

function parseAbbreviatedNumber(string) {
    if (!string) return 0;
    const match = string
        .replace(',', '.')
        .replace(' ', '')
        .match(/([\d,.]+)([MBK]?)/);
    if (match) {
        let [, num, multi] = match;
        num = parseFloat(num);
        return Math.round(multi === 'M' ? num * 1000000 :
            multi === 'B' ? num * 1000000000 :
            multi === 'K' ? num * 1000 : num);
    }
    return 0;
}

async function getStreamAndSize(url, filename = "") {
    try {
        const response = await axios({
            method: "GET",
            url,
            responseType: "stream",
            headers: {
                'Range': 'bytes=0-',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
        });
        
        if (filename) {
            response.data.path = filename;
        }
        
        const totalLength = response.headers["content-length"];
        return {
            stream: response.data,
            size: parseInt(totalLength) || 0
        };
    } catch (error) {
        throw new Error(`Erreur de stream: ${error.message}`);
    }
}

// Recherche YouTube
async function searchYoutube(keyWord) {
    try {
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyWord)}`;
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        
        const html = response.data;
        const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
        
        if (!jsonMatch) {
            throw new Error("Impossible d'extraire les données YouTube");
        }
        
        const data = JSON.parse(jsonMatch[1]);
        const videos = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];
        
        const results = [];
        for (const video of videos) {
            if (video.videoRenderer?.lengthText?.simpleText && video.videoRenderer?.videoId) {
                results.push({
                    id: video.videoRenderer.videoId,
                    title: video.videoRenderer.title.runs?.[0]?.text || 'Titre indisponible',
                    thumbnail: video.videoRenderer.thumbnail?.thumbnails?.pop()?.url || '',
                    duration: video.videoRenderer.lengthText.simpleText,
                    channel: {
                        name: video.videoRenderer.ownerText?.runs?.[0]?.text || 'Chaîne inconnue',
                        id: video.videoRenderer.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || ''
                    }
                });
            }
        }
        
        return results;
    } catch (error) {
        throw new Error(`Erreur de recherche YouTube: ${error.message}`);
    }
}

// Obtenir les informations complètes d'une vidéo
async function getVideoInfo(videoId) {
    try {
        // Nettoyer l'ID si c'est une URL
        if (videoId.includes('youtube.com') || videoId.includes('youtu.be')) {
            const match = videoId.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
            videoId = match ? match[1] : videoId;
        }
        
        const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });
        
        const html = response.data;
        
        // Extraire les données JSON
        const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
        const dataMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
        
        if (!playerMatch) {
            throw new Error("Impossible d'extraire les données de la vidéo");
        }
        
        const playerData = JSON.parse(playerMatch[1]);
        const videoDetails = playerData.videoDetails;
        
        if (!videoDetails) {
            throw new Error("Détails de la vidéo non trouvés");
        }
        
        let additionalData = {};
        if (dataMatch) {
            try {
                additionalData = JSON.parse(dataMatch[1]);
            } catch (e) {
                // Ignorer
            }
        }
        
        // Construire le résultat
        const result = {
            videoId: videoDetails.videoId,
            title: videoDetails.title,
            lengthSeconds: parseInt(videoDetails.lengthSeconds) || 0,
            viewCount: parseInt(videoDetails.viewCount) || 0,
            likes: 0,
            uploadDate: "Date inconnue",
            thumbnails: videoDetails.thumbnail?.thumbnails || [],
            author: videoDetails.author || 'Auteur inconnu',
            channel: {
                name: videoDetails.author || 'Chaîne inconnue',
                subscriberCount: 0,
                thumbnails: []
            }
        };
        
        // Extraire infos supplémentaires
        try {
            const contents = additionalData?.contents?.twoColumnWatchNextResults?.results?.results?.contents;
            if (contents) {
                const secondaryInfo = contents.find(c => c.videoSecondaryInfoRenderer);
                
                if (secondaryInfo?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer) {
                    const owner = secondaryInfo.videoSecondaryInfoRenderer.owner.videoOwnerRenderer;
                    result.channel.name = owner.title?.runs?.[0]?.text || result.channel.name;
                    result.channel.thumbnails = owner.thumbnail?.thumbnails || [];
                    
                    if (owner.subscriberCountText?.simpleText) {
                        result.channel.subscriberCount = parseAbbreviatedNumber(owner.subscriberCountText.simpleText);
                    }
                }
                
                // Essayer d'extraire les likes
                const primaryInfo = contents.find(c => c.videoPrimaryInfoRenderer);
                if (primaryInfo?.videoPrimaryInfoRenderer?.videoActions?.menuRenderer?.topLevelButtons) {
                    const likeButton = primaryInfo.videoPrimaryInfoRenderer.videoActions.menuRenderer.topLevelButtons
                        .find(button => button.segmentedLikeDislikeButtonViewModel);
                    
                    if (likeButton?.segmentedLikeDislikeButtonViewModel?.likeButtonViewModel?.likeButtonViewModel?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.accessibilityText) {
                        const likeText = likeButton.segmentedLikeDislikeButtonViewModel.likeButtonViewModel.likeButtonViewModel.toggleButtonViewModel.toggleButtonViewModel.defaultButtonViewModel.buttonViewModel.accessibilityText;
                        const likeMatch = likeText.match(/[\d,\.]+/);
                        if (likeMatch) {
                            result.likes = parseAbbreviatedNumber(likeMatch[0]);
                        }
                    }
                }
            }
        } catch (e) {
            // Ignorer les erreurs d'extraction
        }
        
        return result;
    } catch (error) {
        throw new Error(`Erreur lors de l'obtention des infos vidéo: ${error.message}`);
    }
}

// Télécharger une vidéo
async function downloadVideo(videoInfo, context) {
    const { sendMessage, log } = context;
    const MAX_SIZE = 83 * 1024 * 1024; // 83MB
    
    try {
        const info = await ytdl.getInfo(videoInfo.videoId);
        const formats = info.formats;
        
        // Chercher le meilleur format vidéo dans les limites
        const videoFormat = formats
            .filter(f => f.hasVideo && f.hasAudio && f.contentLength && parseInt(f.contentLength) < MAX_SIZE)
            .sort((a, b) => parseInt(b.contentLength) - parseInt(a.contentLength))[0];
        
        if (!videoFormat) {
            return {
                success: false,
                message: "⭕ Désolée ! Aucune vidéo trouvée de moins de 83MB ! La vidéo est trop lourde pour Facebook Messenger ! 💕"
            };
        }
        
        const stream = await getStreamAndSize(videoFormat.url, `${videoInfo.videoId}.mp4`);
        
        if (stream.size > MAX_SIZE) {
            return {
                success: false,
                message: "⭕ Oups ! La vidéo est trop lourde (> 83MB) pour être envoyée ! Essaie avec /ytb audio ! 💕"
            };
        }
        
        // Sauvegarder temporairement
        const filename = `${videoInfo.videoId}_${Date.now()}.mp4`;
        const savePath = path.join(tmpDir, filename);
        const writeStream = fs.createWriteStream(savePath);
        
        stream.stream.pipe(writeStream);
        
        return new Promise((resolve) => {
            writeStream.on('finish', () => {
                resolve({
                    success: true,
                    filePath: savePath,
                    filename: filename,
                    size: stream.size
                });
            });
            
            writeStream.on('error', (error) => {
                resolve({
                    success: false,
                    message: `❌ Erreur de téléchargement : ${error.message}`
                });
            });
        });
        
    } catch (error) {
        log.error(`❌ Erreur download vidéo: ${error.message}`);
        return {
            success: false,
            message: `💥 Erreur de téléchargement vidéo : ${error.message} ! Réessaie ou utilise /ytb audio ! 💕`
        };
    }
}

// Télécharger l'audio
async function downloadAudio(videoInfo, context) {
    const { sendMessage, log } = context;
    const MAX_SIZE = 27 * 1024 * 1024; // 27MB
    
    try {
        const info = await ytdl.getInfo(videoInfo.videoId);
        const formats = info.formats;
        
        // Chercher le meilleur format audio
        const audioFormat = formats
            .filter(f => f.hasAudio && !f.hasVideo && f.contentLength && parseInt(f.contentLength) < MAX_SIZE)
            .sort((a, b) => parseInt(b.audioBitrate || 0) - parseInt(a.audioBitrate || 0))[0];
        
        if (!audioFormat) {
            return {
                success: false,
                message: "⭕ Désolée ! Aucun audio trouvé de moins de 27MB ! Essaie avec une vidéo plus courte ! 💕"
            };
        }
        
        const stream = await getStreamAndSize(audioFormat.url, `${videoInfo.videoId}.mp3`);
        
        if (stream.size > MAX_SIZE) {
            return {
                success: false,
                message: "⭕ Oups ! L'audio est trop lourd (> 27MB) pour être envoyé ! 💕"
            };
        }
        
        // Sauvegarder temporairement
        const filename = `${videoInfo.videoId}_${Date.now()}.mp3`;
        const savePath = path.join(tmpDir, filename);
        const writeStream = fs.createWriteStream(savePath);
        
        stream.stream.pipe(writeStream);
        
        return new Promise((resolve) => {
            writeStream.on('finish', () => {
                resolve({
                    success: true,
                    filePath: savePath,
                    filename: filename,
                    size: stream.size
                });
            });
            
            writeStream.on('error', (error) => {
                resolve({
                    success: false,
                    message: `❌ Erreur de téléchargement audio : ${error.message}`
                });
            });
        });
        
    } catch (error) {
        log.error(`❌ Erreur download audio: ${error.message}`);
        return {
            success: false,
            message: `💥 Erreur de téléchargement audio : ${error.message} ! 💕`
        };
    }
}

// Fonction principale
module.exports = async function(senderId, args, context) {
    const { log, sendMessage } = context;
    
    try {
        if (!args.trim()) {
            return `🎥 **Commande YouTube Complète** 📺

**Utilisation :**
• \`/ytb video [recherche ou lien]\` - Télécharger une vidéo (< 83MB)
• \`/ytb audio [recherche ou lien]\` - Télécharger l'audio (< 27MB)
• \`/ytb info [recherche ou lien]\` - Voir les informations

**Exemples :**
• \`/ytb video Fallen Kingdom\`
• \`/ytb audio https://youtu.be/abc123\` 
• \`/ytb info minecraft song\`

⚠️ **Limites Facebook :** Vidéos < 83MB, Audio < 27MB
💡 **Conseil :** Les vidéos courtes fonctionnent mieux !`;
        }
        
        const parts = args.trim().split(' ');
        const command = parts[0].toLowerCase();
        const query = parts.slice(1).join(' ').trim();
        
        if (!['video', 'audio', 'info'].includes(command)) {
            return "❌ Commande invalide ! Utilise : `video`, `audio` ou `info`\nTape `/ytb` sans arguments pour voir l'aide ! 💕";
        }
        
        if (!query) {
            return `❌ Il me faut quelque chose à chercher ! 🔍\nExemple : \`/ytb ${command} Fallen Kingdom\` 💕`;
        }
        
        // Vérifier si c'est un lien YouTube
        const youtubeRegex = /^(?:https?:\/\/)?(?:m\.|www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})(?:\S+)?$/;
        const isYouTubeUrl = youtubeRegex.test(query);
        
        let videoInfo;
        
        if (isYouTubeUrl) {
            await sendMessage(senderId, "🔍 Analyse du lien YouTube... ⏳");
            const match = query.match(youtubeRegex);
            const videoId = match ? match[1] : null;
            
            if (!videoId) {
                return "❌ Lien YouTube invalide ! Vérifie ton URL ! 💕";
            }
            
            videoInfo = await getVideoInfo(videoId);
        } else {
            await sendMessage(senderId, `🔍 Recherche YouTube pour "${query}"... ⏳`);
            
            const searchResults = await searchYoutube(query);
            
            if (searchResults.length === 0) {
                return `❌ Aucun résultat trouvé pour "${query}" ! Essaie avec d'autres mots-clés ! 💕`;
            }
            
            const firstResult = searchResults[0];
            videoInfo = await getVideoInfo(firstResult.id);
        }
        
        // Traitement selon le type
        if (command === 'info') {
            const hours = Math.floor(videoInfo.lengthSeconds / 3600);
            const minutes = Math.floor((videoInfo.lengthSeconds % 3600) / 60);
            const seconds = videoInfo.lengthSeconds % 60;
            const formattedDuration = hours > 0 
                ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
                : `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            return `🎥 **Informations Vidéo**

📺 **Titre :** ${videoInfo.title}
🏪 **Chaîne :** ${videoInfo.channel.name}
👥 **Abonnés :** ${formatNumber(videoInfo.channel.subscriberCount)}
⏱️ **Durée :** ${formattedDuration}
👀 **Vues :** ${formatNumber(videoInfo.viewCount)}
👍 **Likes :** ${formatNumber(videoInfo.likes)}
🆔 **ID :** ${videoInfo.videoId}
🔗 **Lien :** https://youtu.be/${videoInfo.videoId}

💡 Utilise \`/ytb video\` ou \`/ytb audio\` pour télécharger ! ✨`;
        }
        
        if (command === 'video') {
            await sendMessage(senderId, `⬇️ Téléchargement de la vidéo "${videoInfo.title}"... Patiente un peu ! 💕`);
            
            const result = await downloadVideo(videoInfo, context);
            
            if (!result.success) {
                return result.message;
            }
            
            // Envoyer le fichier via Facebook API
            try {
                const fileStream = fs.createReadStream(result.filePath);
                
                // Note: L'envoi de fichier nécessite une implémentation spéciale
                // Pour l'instant, on retourne le message avec le lien
                
                // Nettoyer le fichier temporaire
                setTimeout(() => {
                    if (fs.existsSync(result.filePath)) {
                        fs.unlinkSync(result.filePath);
                    }
                }, 5000);
                
                return `✅ **Vidéo téléchargée avec succès !**

📺 **${videoInfo.title}**
📁 **Taille :** ${Math.round(result.size / 1024 / 1024 * 100) / 100} MB
🏪 **Chaîne :** ${videoInfo.channel.name}

💡 **Note :** L'envoi direct de fichiers sera disponible prochainement !
🔗 **En attendant :** https://youtu.be/${videoInfo.videoId}`;
            } catch (error) {
                return `✅ Vidéo prête mais erreur d'envoi ! Réessaie ! 💕`;
            }
        }
        
        if (command === 'audio') {
            await sendMessage(senderId, `⬇️ Téléchargement de l'audio "${videoInfo.title}"... Un instant ! 💕`);
            
            const result = await downloadAudio(videoInfo, context);
            
            if (!result.success) {
                return result.message;
            }
            
            // Nettoyer le fichier temporaire
            setTimeout(() => {
                if (fs.existsSync(result.filePath)) {
                    fs.unlinkSync(result.filePath);
                }
            }, 5000);
            
            return `✅ **Audio téléchargé avec succès !**

🎵 **${videoInfo.title}**
📁 **Taille :** ${Math.round(result.size / 1024 / 1024 * 100) / 100} MB
🏪 **Chaîne :** ${videoInfo.channel.name}

💡 **Note :** L'envoi direct de fichiers sera disponible prochainement !
🔗 **En attendant :** https://youtu.be/${videoInfo.videoId}`;
        }
        
    } catch (error) {
        log.error(`❌ Erreur commande YouTube: ${error.message}`);
        
        if (error.message.includes('timeout')) {
            return "⏱️ Oh là là ! YouTube met du temps à répondre... Réessaie dans quelques instants ! 💕";
        }
        
        if (error.message.includes('Video unavailable')) {
            return "📺 Cette vidéo n'est pas disponible ! Elle est peut-être privée ou supprimée ! 💕";
        }
        
        if (error.message.includes('429')) {
            return "🚦 YouTube nous demande de ralentir ! Réessaie dans quelques minutes ! 💕";
        }
        
        return `💥 Oups ! Une petite erreur s'est produite ! 
        
🔧 **Erreur :** ${error.message}

💡 **Suggestions :**
• Vérifie que la vidéo est publique
• Essaie avec des vidéos plus courtes
• Réessaie dans quelques instants

💕 Tape \`/ytb\` pour revoir l'aide !`;
    }
};
