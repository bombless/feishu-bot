require("dotenv").config();
const Lark = require("@larksuiteoapi/node-sdk");

const baseConfig = {
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
};

const client = new Lark.Client(baseConfig);

const wsClient = new Lark.WSClient({...baseConfig, loggerLevel: Lark.LoggerLevel.debug});
wsClient.start({
  // 处理「接收消息」事件，事件类型为 im.message.receive_v1
  eventDispatcher: new Lark.EventDispatcher({}).register({
    'im.message.receive_v1': async (data) => {
      const {
        message: { chat_id, content}
      } = data;
      // 示例操作：接收消息后，调用「发送消息」API 进行消息回复。
      await client.im.v1.message.create({
        params: {
          receive_id_type: "chat_id"
        },
        data: {
          receive_id: chat_id,
          content: Lark.messageCard.defaultCard({
            title: `回复： ${JSON.parse(content).text}`,
            content: '新年好'
          }),
          msg_type: 'interactive'
        }
      });
    }
  })
});


console.log("🤖 飞书机器人已启动（长连接模式）");
