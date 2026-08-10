require("dotenv").config();
const Lark = require("@larksuiteoapi/node-sdk");
const CaveGame = require('./module_cave_game');

const baseConfig = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
};

const client = new Lark.Client(baseConfig);

const chatState = new Map;

const wsClient = new Lark.WSClient({...baseConfig, loggerLevel: Lark.LoggerLevel.debug});
wsClient.start({
  // 处理「接收消息」事件，事件类型为 im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const {
        message: { chat_id, content}
      } = data;
      let responseTitle
      let responseContent
      if (chatState.get(chat_id)) {
        try {
            const modu = chatState.get(chat_id);
            const r = await modu.ask(JSON.parse(content).text);
            responseTitle = '请选择';
            responseContent = r;
        } catch (e) {
            responseTitle = '错误';
            responseContent = e.toString();
        }
      } else {
        switch (JSON.parse(content).text.trim()) {
            case 'help':
                responseTitle = '帮助目录';
                responseContent = `
help 本帮助目录；
cave 洞穴游戏；
`
            break;
            case 'cave':
                const game = new CaveGame;
                chatState.set(chat_id, game);
                responseTitle = '洞穴游戏';
                responseContent = game.prompt();
            break;
        }

      }

      console.log(responseContent)
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id"
        },
        data: {
          receive_id: chat_id,
          content: Lark.messageCard.defaultCard({
            title: responseTitle,
            content: responseContent,
          }),
          msg_type: 'interactive'
        }
      });
    }
  })
});


console.log("🤖 飞书机器人已启动（长连接模式）");
