/**
 * Commande /help - Affichage de l'aide avec boutons cliquables
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin } = ctx;
    
    try {
        const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/HELP-NAKAMA.png';
        await ctx.sendImageMessage(senderId, imageUrl);
    } catch (err) {
        ctx.log.error(`❌ Erreur image: ${err.message}`);
    }

    // Fonction corrigée pour envoyer des Quick Replies (plus fiable que les Button Templates)
    async function sendQuickReplies(recipientId, text, quickReplies) {
        if (!ctx.PAGE_ACCESS_TOKEN) {
            ctx.log.error("❌ PAGE_ACCESS_TOKEN manquant");
            return { success: false, error: "No token" };
        }

        const data = {
            recipient: { id: String(recipientId) },
            message: {
                text: text,
                quick_replies: quickReplies
            }
        };

        try {
            const axios = require('axios');
            const response = await axios.post(
                "https://graph.facebook.com/v18.0/me/messages",
                data,
                {
                    params: { access_token: ctx.PAGE_ACCESS_TOKEN },
                    timeout: 15000
                }
            );

            if (response.status === 200) {
                ctx.log.info(`✅ Quick replies envoyées à ${recipientId}`);
                return { success: true };
            } else {
                ctx.log.error(`❌ Erreur Facebook API: ${response.status}`);
                return { success: false, error: `API Error ${response.status}` };
            }
        } catch (error) {
            ctx.log.error(`❌ Erreur envoi quick replies: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    await ctx.sleep(300);

    // Message principal avec Quick Replies pour commandes BASE
    let mainText = `╔═══════════╗
║ 🤖 NAKAMABOT v4.0║
║ ----------HELP 🤖----------║
╚═══════════╝

🏠 COMMANDES BASE:
Clique sur les boutons ci-dessous ! ⬇️`;

    await sendQuickReplies(senderId, mainText, [
        {
            content_type: "text",
            title: "🏠 /start",
            payload: "/start"
        },
        {
            content_type: "text", 
            title: "💬 /chat",
            payload: "/chat"
        },
        {
            content_type: "text",
            title: "🏆 /rank",
            payload: "/rank"
        }
    ]);

    await ctx.sleep(1000);

    // Message MÉDIA avec Quick Replies
    let mediaText = `🎵 COMMANDES MÉDIA:
Génération d'images et transformations ! 🎨`;

    await sendQuickReplies(senderId, mediaText, [
        {
            content_type: "text",
            title: "🎵 /music",
            payload: "/music"
        },
        {
            content_type: "text",
            title: "🎨 /image",
            payload: "/image"
        },
        {
            content_type: "text",
            title: "🎭 /anime",
            payload: "/anime"
        }
    ]);

    await ctx.sleep(1000);

    // Message VISION & CLANS avec Quick Replies
    let visionText = `👁️ VISION & ⚔️ CLANS:
Analyse d'images et système de guerre ! 👁️⚔️`;

    await sendQuickReplies(senderId, visionText, [
        {
            content_type: "text",
            title: "👁️ /vision",
            payload: "/vision"
        },
        {
            content_type: "text",
            title: "⚔️ /clan help",
            payload: "/clan help"
        },
        {
            content_type: "text",
            title: "🔍 /search",
            payload: "/search"
        }
    ]);

    await ctx.sleep(1000);

    // Boutons ADMIN (si admin)
    if (isAdmin(senderId)) {
        let adminText = `🔐 COMMANDES ADMIN:
Panel d'administration spécial ! 🔐`;

        await sendQuickReplies(senderId, adminText, [
            {
                content_type: "text",
                title: "📊 /stats",
                payload: "/stats"
            },
            {
                content_type: "text",
                title: "🔐 /admin", 
                payload: "/admin"
            },
            {
                content_type: "text",
                title: "📢 /broadcast",
                payload: "/broadcast"
            }
        ]);

        await ctx.sleep(1000);

        // Boutons admin avancés
        let adminAdvText = `🔐 ADMIN AVANCÉ:
Gestion système du bot ! ⚙️`;

        await sendQuickReplies(senderId, adminAdvText, [
            {
                content_type: "text",
                title: "⏹️ /stop-broadcast",
                payload: "/stop-broadcast"
            },
            {
                content_type: "text",
                title: "🔄 /restart",
                payload: "/restart"
            },
            {
                content_type: "text",
                title: "❓ /help",
                payload: "/help"
            }
        ]);
    }

    await ctx.sleep(1000);

    // Message final sans boutons
    let finalText = `════════════════════════
📝 INSTRUCTIONS:
🎨 Images: Tape "/image [description]"
🎭 Anime: Envoie une image + "/anime"
👁️ Vision: Envoie une image + "/vision"
🏆 Expérience: Gagne des niveaux en discutant !

💡 Tu peux soit:
• Cliquer sur les boutons ⬆️
• Taper directement les commandes

╰─▸ Créé avec 💕 par Durand
💖 Toujours là pour t'aider ! ✨`;

    await ctx.sendMessage(senderId, finalText);

    return null; // Pas de retour car tout est envoyé directement
};
