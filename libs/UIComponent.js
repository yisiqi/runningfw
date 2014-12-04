jQuery.sap.require("sap.ui.core.mvc.View")
jQuery.sap.declare("inspur.gsp.commons.UIComponent")

sap.ui.core.UIComponent.extend('inspur.gsp.commons.UIComponent', {

	constructor			: function(settings) {
		this.transientModels = []
		if (settings) {
			this["__gsp_meta__"] = jQuery.extend(true, {}, settings["__gsp_meta__"])
			delete settings["__gsp_meta__"]
		}
		sap.ui.core.UIComponent.apply(this, arguments)
		this.restoreModels()
		window.onbeforeunload = this.onBeforeWindowClosed
		window.onunload = this.onWindowClosed
	}

	, init				: function() {
		sap.ui.core.UIComponent.prototype.init.apply(this, arguments)
	}

	, onBeforeWindowClosed	: function() {
		return "正在离开应用...\n\n你可以通过重载Component中的'onBeforeWindowClosed'、'onWindowClosed'两个方法来实现自定义销毁。";
	}

	, onWindowClosed	: function() {
		jQuery.ajax({url:"http://www.baidu.com"})
	}

	/*
	, _fetchProxClass: function(fullName) {
		var ns = fullName.split('.'),
			c = window
		for (var i in ns) {
			c = c[ns[i]]
		}
		return c
	}
	//*/

	, getGSPMeta		: function(key) {
		if (!key)
			return this["__gsp_meta__"]
		else
			return this["__gsp_meta__"][key]
	}

	, restoreModels		: function() {

		var models = this.getGSPMeta("models")

		if (!models) return

		for (var n in models) {
			if (this.transientModels[n]) continue
			this.setModel(models[n], n === "DEFAULT" ? undefined : n)
		}

	}

	, getPersitenceModels	: function() {

		var allModels = this.oModels
			, persisModel = {}
		for (var n in allModels) {
			if (this.transientModels[n]) continue
			persisModel[n] = allModels[n]
		}

		return persisModel
		
	}

	, setTransientModel	: function(model, name) {
		this.transientModels[name || "DEFAULT"] = true
		this.setModel(model, name)
	}

})

inspur.gsp.commons.UIComponent.getGSPMetaFor = function(oControllerOrView) {

	var oView = oControllerOrView;
	if (oView instanceof sap.ui.core.mvc.Controller) {
		oView = oView.getView();
	}
	if (oView instanceof sap.ui.core.mvc.View) {
		var sOwner = sap.ui.core.Component.getOwnerIdFor(oView),
			oComponent = sap.ui.component(sOwner);

		if (oComponent) {
			return oComponent.getGSPMeta();
		} else {
			return undefined;
		}
	}

}