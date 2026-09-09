// Reviewed local sprite catalog; source rectangles, hashes and support anchors are in assets/companions/manifest.json.
export const COMPANION_CATALOG = {
  "chatgpt": {
    "palette": [
      "#F5F1FA",
      "#73769E",
      "#3E4669"
    ],
    "top": [
      {
        "file": "assets/companions/chatgpt-top.png",
        "width": 560,
        "height": 436,
        "anchorX": 0.5,
        "anchorY": 0.935,
        "edge": "top",
        "notes": "横向支撑线对准枕物或书籍下缘，发丝/衣袖可垂到边框下。"
      },
      {
        "file": "assets/companions/chatgpt-top-rest.png",
        "width": 560,
        "height": 348,
        "anchorX": 0.5,
        "anchorY": 0.97,
        "edge": "top",
        "notes": "睡姿落在抱枕与前臂下缘。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/chatgpt-side.png",
        "width": 433,
        "height": 481,
        "anchorX": 0.667,
        "anchorY": 0.5,
        "edge": "left",
        "notes": "素材内有真实扶边竖线；按该 x 对准容器边框，保持原方向。"
      },
      {
        "file": "assets/companions/chatgpt-side-alt.png",
        "width": 375,
        "height": 450,
        "anchorX": 0.014,
        "anchorY": 0.5,
        "edge": "right",
        "notes": "图中左侧扶边线对齐容器右边，保持原图方向。"
      }
    ]
  },
  "deepseek": {
    "palette": [
      "#EEF2FB",
      "#667EAE",
      "#263555"
    ],
    "top": [
      {
        "file": "assets/companions/deepseek-top.png",
        "width": 560,
        "height": 325,
        "anchorX": 0.5,
        "anchorY": 0.977,
        "edge": "top",
        "notes": "横向支撑线对准枕物或书籍下缘，发丝/衣袖可垂到边框下。"
      },
      {
        "file": "assets/companions/deepseek-top-lean.png",
        "width": 560,
        "height": 516,
        "anchorX": 0.5,
        "anchorY": 0.69,
        "edge": "top",
        "notes": "前臂趴在上沿；伸出的手自然垂到边框下面。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/deepseek-side.png",
        "width": 243,
        "height": 560,
        "anchorX": 0.057,
        "anchorY": 0.5,
        "edge": "right",
        "notes": "素材内有真实扶边竖线；按该 x 对准容器边框，保持原方向。"
      },
      {
        "file": "assets/companions/deepseek-side-alt.png",
        "width": 432,
        "height": 463,
        "anchorX": 0.025,
        "anchorY": 0.5,
        "edge": "right",
        "notes": "图中左侧扶边线对齐容器右边。"
      }
    ]
  },
  "claude": {
    "palette": [
      "#F6EDDF",
      "#B86943",
      "#423329"
    ],
    "top": [
      {
        "file": "assets/companions/claude-top.png",
        "width": 560,
        "height": 496,
        "anchorX": 0.5,
        "anchorY": 0.961,
        "edge": "top",
        "notes": "横向支撑线对准枕物或书籍下缘，发丝/衣袖可垂到边框下。"
      },
      {
        "file": "assets/companions/claude-top-rest.png",
        "width": 560,
        "height": 425,
        "anchorX": 0.5,
        "anchorY": 0.905,
        "edge": "top",
        "notes": "以书堆下缘为水平支撑线，袖子下垂。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/claude-side.png",
        "width": 527,
        "height": 524,
        "anchorX": 0.5,
        "anchorY": 0.977,
        "edge": "bottom",
        "notes": "阅读/指示坐姿，无扶边竖线；放侧栏底部角落，底部落脚，不冒充扒边。"
      },
      {
        "file": "assets/companions/claude-side-portrait.png",
        "width": 415,
        "height": 560,
        "anchorX": 0.5,
        "anchorY": 0.985,
        "edge": "bottom",
        "notes": "持书半身像落在区域底角；没有扶边动作，不冒充扒边。"
      }
    ]
  },
  "kimi": {
    "palette": [
      "#EAEFFC",
      "#5767AD",
      "#273354"
    ],
    "top": [
      {
        "file": "assets/companions/kimi-top.png",
        "width": 560,
        "height": 398,
        "anchorX": 0.5,
        "anchorY": 0.952,
        "edge": "top",
        "notes": "横向支撑线对准枕物或书籍下缘，发丝/衣袖可垂到边框下。"
      },
      {
        "file": "assets/companions/kimi-top-rest.png",
        "width": 560,
        "height": 380,
        "anchorX": 0.5,
        "anchorY": 0.965,
        "edge": "top",
        "notes": "伏在书堆上的休息姿势，以书底为支撑。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/kimi-side.png",
        "width": 509,
        "height": 519,
        "anchorX": 0.5,
        "anchorY": 0.99,
        "edge": "bottom",
        "notes": "阅读/指示坐姿，无扶边竖线；放侧栏底部角落，底部落脚，不冒充扒边。"
      },
      {
        "file": "assets/companions/kimi-side-reading.png",
        "width": 522,
        "height": 528,
        "anchorX": 0.5,
        "anchorY": 0.985,
        "edge": "bottom",
        "notes": "坐姿阅读落在区域底角，不放到垂直扶边线上。"
      }
    ]
  },
  "grok": {
    "palette": [
      "#F7EFE1",
      "#B79663",
      "#282328",
      "#733D49"
    ],
    "top": [
      {
        "file": "assets/companions/grok-top.png",
        "width": 558,
        "height": 397,
        "anchorX": 0.5,
        "anchorY": 0.914,
        "edge": "top",
        "notes": "横向支撑线对准枕物或书籍下缘，发丝/衣袖可垂到边框下。"
      },
      {
        "file": "assets/companions/grok-top-rest.png",
        "width": 560,
        "height": 416,
        "anchorX": 0.5,
        "anchorY": 0.975,
        "edge": "top",
        "notes": "睡姿靠在抱枕上，以抱枕下缘对齐外框。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/grok-side.png",
        "width": 366,
        "height": 560,
        "anchorX": 0.097,
        "anchorY": 0.5,
        "edge": "right",
        "notes": "素材内有真实扶边竖线；按该 x 对准容器边框，保持原方向。"
      },
      {
        "file": "assets/companions/grok-top-upset.png",
        "width": 560,
        "height": 322,
        "anchorX": 0.5,
        "anchorY": 0.97,
        "edge": "bottom",
        "notes": "双手按住栏内底角区域的水平边缘；不作为竖向扒边，保留头顶情绪装饰。"
      }
    ]
  },
  "qianwen": {
    "palette": [
      "#EEE9FA",
      "#8171B5",
      "#322B47"
    ],
    "top": [
      {
        "file": "assets/companions/qianwen-top.png",
        "width": 560,
        "height": 350,
        "anchorX": 0.5023,
        "anchorY": 0.9286,
        "edge": "top",
        "notes": "伏在双臂上的睡姿；横向受力线对齐前臂下缘，发丝允许垂过外框。"
      },
      {
        "file": "assets/companions/qianwen-top-lean.png",
        "width": 393,
        "height": 560,
        "anchorX": 0.4889,
        "anchorY": 0.9611,
        "edge": "top",
        "notes": "托腮倚靠姿势；横向受力线对齐前臂与扇子所在下缘，袖角允许垂过边框。"
      }
    ],
    "side": [
      {
        "file": "assets/companions/qianwen-side.png",
        "width": 429,
        "height": 514,
        "anchorX": 0.8135,
        "anchorY": 0.4883,
        "edge": "left",
        "notes": "双手扒住图中右侧竖线；按真实扶边线对齐容器左边，不放中央，不镜像。"
      },
      {
        "file": "assets/companions/qianwen-side-alt.png",
        "width": 317,
        "height": 495,
        "anchorX": 0.9621,
        "anchorY": 0.503,
        "edge": "left",
        "notes": "困倦扒边姿势；图中竖线固定对齐容器左边，保持完整帽饰、双手和辫结。"
      }
    ]
  }
};
