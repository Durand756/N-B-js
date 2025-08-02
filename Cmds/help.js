/**
 * Commande /help - Affichage de l'aide avec boutons cliquables
 * @param {string} senderId - ID de l'utilisateur
 * @param {string} args - Arguments de la commande
 * @param {object} ctx - Contexte partagé du bot
 */
module.exports = async function cmdHelp(senderId, args, ctx) {
    const { isAdmin, sendMessage } = ctx;
    
    try {
        const imageUrl = 'https://raw.githubusercontent.com/Durand756/N-B-js/refs/heads/main/Cmds/imgs/HELP-NAKAMA.png';
        await ctx.sendImageMessage(senderId, imageUrl);
    } catch (err) {
        ctx.log.error(`❌ Erreur image: ${err.message}`);
    }    
    
    // Message texte principal
    let text = `╔═══════════╗
║ 🤖 NAKAMABOT v4.0║
║ ----------HELP 🤖----------║
╚═══════════╝
✨ COMMANDES PRINCIPALES disponibles:`;

    // Envoyer le message texte principal
    await sendMessage(senderId, text);

    // Fonction pour envoyer des boutons avec l'API Facebook
    async function sendButtonMessage(recipientId, text, buttons) {
        if (!ctx.PAGE_ACCESS_TOKEN) {
            ctx.log.error("❌ PAGE_ACCESS_TOKEN manquant");
            return { success: false, error: "No token" };
        }

        const data = {
            recipient: { id: String(recipientId) },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "button",
                        text: text,
                        buttons: buttons
                    }
                }
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
                return { success: true };
            } else {
                ctx.log.error(`❌ Erreur Facebook API: ${response.status}`);
                return { success: false, error: `API Error ${response.status}` };
            }
        } catch (error) {
            ctx.log.error(`❌ Erreur envoi boutons: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Fonction pour envoyer des boutons rapides
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

    // Délai entre les messages
    await ctx.sleep(500);

    // 🏠 COMMANDES BASE
    await sendButtonMessage(senderId, "🏠 COMMANDES BASE:", [
        {
            type: "postback",
            title: "🏠 /start",
            payload: "/start"
        },
        {
            type: "postback", 
            title: "❓ /help",
            payload: "/help"
        },
        {
            type: "postback",
            title: "💬 /chat",
            payload: "/chat Salut !"
        }
    ]);

    await ctx.sleep(800);

    // 🎵 COMMANDES MÉDIA
    await sendButtonMessage(senderId, "🎵 COMMANDES MÉDIA:", [
        {
            type: "postback",
            title: "🎵 /music",
            payload: "/music"
        },
        {
            type: "postback",
            title: "🎨 /image",
            payload: "/image chat mignon"
        },
        {
            type: "postback",
            title: "🎭 /anime",
            payload: "/anime"
        }
    ]);

    await ctx.sleep(800);

    // Bouton Vision et Clan
    await sendQuickReplies(senderId, "👁️ VISION & ⚔️ CLANS:", [
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
            title: "🏆 /rank",
            payload: "/rank"
        }
    ]);

    await ctx.sleep(800);

    // 🔐 COMMANDES ADMIN (si admin)
    if (isAdmin(senderId)) {
        await sendButtonMessage(senderId, "🔐 COMMANDES ADMIN:", [
            {
                type: "postback",
                title: "📊 /stats",
                payload: "/stats"
            },
            {
                type: "postback",
                title: "🔐 /admin", 
                payload: "/admin"
            },
            {
                type: "postback",
                title: "📢 /broadcast",
                payload: "/broadcast"
            }
        ]);

        await ctx.sleep(800);

        await sendQuickReplies(senderId, "🔐 ADMIN AVANCÉ:", [
            {
                content_type: "text",
                title: "⏹️ /stop-broadcast",
                payload: "/stop-broadcast"
            },
            {
                content_type: "text",
                title: "🔄 /restart",
                payload: "/restart"
            }
        ]);
    }

    await ctx.sleep(800);

    // Message final avec instructions
    const finalText = `════════════════════════
🎨 Images: Envoie ta description !
🎭 Anime: Image + "/anime" !
👁️ Vision: Image + "/vision" !
🏆 Expérience: Gagne des niveaux !
╰─▸ Créé avec 💕 par Durand
💖 Toujours là pour t'aider ! ✨

💡 Clique sur les boutons ci-dessus ou tape directement les commandes !`;

    await sendMessage(senderId, finalText);

    return null; // Ne pas renvoyer de texte car tout est envoyé via les fonctions
};
