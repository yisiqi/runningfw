jQuery.sap.declare('inspur.gsp.myhelloworld.Component') // 命名空间在创建向导中由用户填写。此处为必填项。
jQuery.sap.require('sap.ui.core.UIComponent')

sap.ui.core.UIComponent.extend('inspur.gsp.myhelloworld.Component', { // 命名空间与上面定义必须一致。

	metadata: {
		"name": "Hello World",
		"version": "0.1.1",
		"include": [],
		"dependencies": {
			"libs": ["sap.ui.core", "sap.ui.commons"],
			"components": []
		},
		"rootView": "inspur.gsp.myhelloworld.Main",
		"config": {
			"resourceBundle": ["i18n/messageBundle.properties"]
		},
		"routing": {}
	},

	init: function() {

		sap.ui.core.UIComponent.prototype.init.apply(this, arguments);	// 相当于调用supper.init方法
		var oModel = new sap.ui.model.json.JSONModel();
		this.setModel(oModel, "oModel");
		var rootPath = jQuery.sap.getModulePath("inspur.gsp.myhelloworld");
		var mConfig = this.getMetadata().getConfig();
		var i18nModel = new sap.ui.model.resource.ResourceModel({
			bundleUrl: [rootPath, mConfig.resourceBundle].join("/")
		});
		this.setModel(i18nModel, "i18n");
	}

	// 以下可以包含用户自由组织的代码
})