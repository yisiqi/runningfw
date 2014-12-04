jQuery.sap.require("inspur.gsp.commons.UIComponent")
jQuery.sap.require("inspur.gsp.commons.RuntimeModel")
jQuery.sap.declare("inspur.gsp.commons.RuntimeComponent")

inspur.gsp.commons.UIComponent.extend('inspur.gsp.commons.RuntimeComponent', {


	init: function() {
		inspur.gsp.commons.UIComponent.prototype.init.apply(this, arguments)
	}

	, onBeforeRendering : function() {
		this.rtModel = new inspur.gsp.commons.RuntimeModel(this.getAggregation("rootControl").byId("tabstrip"))
		this.setModel(this.rtModel, "runtime")
	}

})

inspur.gsp.commons.RuntimeComponent.getGSPMetaFor = inspur.gsp.commons.UIComponent.getGSPMetaFor
