jQuery.sap.declare('inspur.gsp.rt.gspweb.Component') // 命名空间在创建向导中由用户填写。此处为必填项。
//jQuery.sap.require('sap.ui.core.UIComponent')
jQuery.sap.require('inspur.gsp.commons.RuntimeComponent')

inspur.gsp.commons.RuntimeComponent.extend('inspur.gsp.rt.gspweb.Component', { // 命名空间与上面定义必须一致。

	metadata: {
		"name": "Form Case",
		"version": "0.1.1",
		"include": [],
		"dependencies": {
			"libs": ["sap.ui.core","sap.ui.commons","sap.ui.table","sap.ui.ux3"],
			"components": []
		},
		"rootView": "inspur.gsp.rt.gspweb.Main",
		"config": {
			"resourceBundle": ["i18n/messageBundle.properties"]
		},
		"routing": {}
	},

	init: function() {

		inspur.gsp.commons.RuntimeComponent.prototype.init.apply(this, arguments);

		// var oModelHeaderItem = new sap.ui.model.json.JSONModel();	// Header的数据
		// this.setModel(oModelHeaderItem, "oModelHeaderItem");

		// var oModelWorksetItem = new sap.ui.model.json.JSONModel();	// Workset的数据
		// this.setModel(oModelWorksetItem, "oModelWorksetItem	");

		// var oModelForMenuTree = new sap.ui.model.json.JSONModel();	// 右边的显示树数据(蔬菜菜单，TreeNode数据)
		// this.setModel(oModelForMenuTree, "oModelForMenuTree");

		var rootPath = jQuery.sap.getModulePath("inspur.gsp.rt.gspweb");
		var mConfig = this.getMetadata().getConfig();

		var i18nModel = new sap.ui.model.resource.ResourceModel({
			bundleUrl: [rootPath, mConfig.resourceBundle].join("/")
		});
		this.setModel(i18nModel, "i18n");
	}

	// 以下可以包含用户自由组织的代码
})