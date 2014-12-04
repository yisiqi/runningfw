jQuery.sap.require("sap.ui.core.mvc.View")
jQuery.sap.require("inspur.gsp.commons.RuntimeModel")
jQuery.sap.declare("inspur.gsp.commons.RuntimeComponent")

sap.ui.core.UIComponent.extend('inspur.gsp.commons.RuntimeComponent', {

  constructor: function(settings) {
    this.transientModels = []
    if (settings) {
      this["__gsp_meta__"] = jQuery.extend(true, {}, settings["__gsp_meta__"])
      delete settings["__gsp_meta__"]
    }
    sap.ui.core.UIComponent.apply(this, arguments)
    this.restoreModels()
    window.onbeforeunload = this.onBeforeWindowClosed
    window.onunload = this.onWindowClosed
    //this.rtmodel = new inspur.gsp.commons.RuntimeModel("");
    //rtmodel.funcContainer = ""
  }

  , init: function() {
    sap.ui.core.UIComponent.prototype.init.apply(this, arguments)
  }

  , onBeforeRendering : function() {
    this.rtModel = new inspur.gsp.commons.RuntimeModel(this.getAggregation("rootControl").byId("tabstrip"))
    this.setModel(this.rtModel, "runtime")
  }

  , onAfterRendering  : function() {
    
  }

  , onBeforeWindowClosed: function() {
    //alert("Window is closing.\n You can define your own destory process by override the 'onWindowClosed' function in RuntimeComponent.")
    // return "正在离开应用。\n\n你可以通过重载RuntimeComponent中的'onWindowClosed'、'onBeforeWindowClosed'两个方法来实现自定义销毁。";
  }

  , onWindowClosed: function() {
    jQuery.ajax({url:"http://www.baidu.com"})
  }

  , _fetchProxClass: function(fullName) {
    var ns = fullName.split('.'),
      c = window
    for (var i in ns) {
      c = c[ns[i]]
    }
    return c
  }

  , getGSPMeta: function(key) {
    if (!key)
      return this["__gsp_meta__"]
    else
      return this["__gsp_meta__"][key]
  }

  , restoreModels: function() {

    var models = this.getGSPMeta("models")

    if (!models) return

    for (var n in models) {
      if (this.transientModels[n]) continue
      this.setModel(models[n], n === "DEFAULT" ? undefined : n)
    }

  }

  , setTransientModel: function(model, name) {
    this.transientModels[name || "DEFAULT"] = true
    this.setModel(model, name)
  }

})

inspur.gsp.commons.RuntimeComponent.getGSPMetaFor = function(oControllerOrView) {

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